"""Shared Firestore REST helpers for scheduled Python sync jobs."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

FIRESTORE_API_BASE = "https://firestore.googleapis.com/v1"
MAX_RETRIES = 5
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def firestore_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [firestore_value(item) for item in value]}}
    if isinstance(value, dict):
        return {
            "mapValue": {
                "fields": {
                    key: firestore_value(child)
                    for key, child in value.items()
                }
            }
        }
    raise TypeError(f"Unsupported Firestore value type: {type(value).__name__}")


def firestore_fields(value):
    return {key: firestore_value(child) for key, child in value.items()}


def firestore_value_to_json(value):
    if value is None or "nullValue" in value:
        return None
    for field in ("booleanValue", "stringValue", "timestampValue", "doubleValue"):
        if field in value:
            return value[field]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "arrayValue" in value:
        return [
            firestore_value_to_json(item)
            for item in value["arrayValue"].get("values", [])
        ]
    if "mapValue" in value:
        return {
            key: firestore_value_to_json(child)
            for key, child in value["mapValue"].get("fields", {}).items()
        }
    raise ValueError("Unsupported Firestore value.")


def _document_name(project_id, segments):
    return (
        f"projects/{project_id}/databases/(default)/documents/"
        + "/".join(str(segment) for segment in segments)
    )


def _request(session, method, url, **kwargs):
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = session.request(method, url, **kwargs)
            if response.status_code not in TRANSIENT_STATUS:
                return response
            if attempt == MAX_RETRIES - 1:
                return response
        except Exception as exc:
            last_error = exc
            if attempt == MAX_RETRIES - 1:
                raise
        time.sleep(2 ** attempt)
    raise last_error


def _read_document(session, project_id, token, segments):
    name = _document_name(project_id, segments)
    encoded = "/".join(quote(str(segment), safe="") for segment in segments)
    response = _request(
        session,
        "GET",
        (
            f"{FIRESTORE_API_BASE}/projects/{project_id}/databases/"
            f"(default)/documents/{encoded}"
        ),
        headers={"Authorization": f"Bearer {token}"},
    )
    if response.status_code == 404:
        return {"exists": False, "data": None, "update_time": None}
    if not response.ok:
        raise RuntimeError(
            f"Firestore read failed ({response.status_code}): {response.text}"
        )
    document = response.json()
    return {
        "exists": True,
        "data": {
            key: firestore_value_to_json(value)
            for key, value in document.get("fields", {}).items()
        },
        "update_time": document["updateTime"],
    }


def _commit_document(session, project_id, token, segments, data, current):
    precondition = (
        {"updateTime": current["update_time"]}
        if current["exists"]
        else {"exists": False}
    )
    response = _request(
        session,
        "POST",
        (
            f"{FIRESTORE_API_BASE}/projects/{project_id}/databases/"
            "(default)/documents:commit"
        ),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "writes": [
                {
                    "update": {
                        "name": _document_name(project_id, segments),
                        "fields": firestore_fields(data),
                    },
                    "currentDocument": precondition,
                }
            ]
        },
    )
    if response.status_code in (409, 412):
        return False
    if not response.ok:
        raise RuntimeError(
            f"Firestore write failed ({response.status_code}): {response.text}"
        )
    return True


def update_document(session, project_id, token, segments, update):
    for _attempt in range(MAX_RETRIES):
        current = _read_document(session, project_id, token, segments)
        next_value = update(current["data"])
        if next_value is None:
            return None
        if _commit_document(
            session, project_id, token, segments, next_value, current
        ):
            return next_value
    raise RuntimeError(
        f"Firestore document changed during {MAX_RETRIES} update attempts: "
        f"{'/'.join(segments)}"
    )


def get_firestore_access(service_account_key):
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    key = (
        json.loads(service_account_key)
        if isinstance(service_account_key, str)
        else service_account_key
    )
    credentials = service_account.Credentials.from_service_account_info(
        key,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    credentials.refresh(Request())
    return key["project_id"], credentials.token


def merge_entries(existing, incoming, key_field, overwrite):
    by_key = {str(entry[key_field]): entry for entry in existing}
    added = 0
    updated = 0
    for entry in incoming:
        key = str(entry[key_field])
        if key not in by_key:
            by_key[key] = entry
            added += 1
        elif overwrite:
            by_key[key] = entry
            updated += 1
    entries = sorted(
        by_key.values(),
        key=lambda entry: f"{entry['date']}:{entry[key_field]}",
    )
    return entries, added, updated


def read_year_entries(session, project_id, token, uid, collection, years):
    entries = []
    for year in sorted(set(years)):
        current = _read_document(
            session, project_id, token, ["users", uid, collection, year]
        )
        entries.extend(current["data"].get("entries", []) if current["data"] else [])
    return entries


def merge_year_bucket_entries(
    session,
    project_id,
    token,
    uid,
    collection,
    incoming,
    key_field,
    overwrite,
):
    by_year = {}
    for entry in incoming:
        year = entry.get("date", "")[:4]
        if len(year) != 4 or not year.isdigit():
            raise ValueError(f"Invalid entry date: {entry.get('date')}")
        by_year.setdefault(year, []).append(entry)

    totals = {"added": 0, "updated": 0}
    for year, year_entries in sorted(by_year.items()):
        result = {"added": 0, "updated": 0}

        def merge(current):
            entries, added, updated = merge_entries(
                (current or {}).get("entries", []),
                year_entries,
                key_field,
                overwrite,
            )
            result["added"] = added
            result["updated"] = updated
            return {
                "period": year,
                "count": len(entries),
                "entries": entries,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }

        update_document(
            session,
            project_id,
            token,
            ["users", uid, collection, year],
            merge,
        )
        totals["added"] += result["added"]
        totals["updated"] += result["updated"]
    return totals


def merge_settings_values(session, project_id, token, uid, values):
    return update_document(
        session,
        project_id,
        token,
        ["users", uid, "settings", "app"],
        lambda current: {
            **(current or {}),
            "values": {**(current or {}).get("values", {}), **values},
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
    )
