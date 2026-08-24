# Feature: Nightly Garmin-to-Gaia Track Sync

> Copy new Garmin hiking and mountaineering GPS tracks into a dedicated Gaia GPS folder each night, without duplicating tracks.

## What

A standalone nightly sync finds new activities whose Garmin `activityType.typeKey` is `hiking` or `mountaineering`. It downloads each activity's GPX export, verifies that it contains track points with valid latitude and longitude attributes, and imports valid tracks into a configured Gaia folder. Other activity types and activities without coordinates are skipped and reported.

Garmin coordinates are feasible: Garmin's Activity API documents FIT/GPX/TCX activity files, and the already-used unofficial `python-garminconnect` client exposes `download_activity(activity_id, Garmin.ActivityDownloadFormat.GPX)`, returning the raw bytes from Garmin Connect's `/download-service/export/gpx/activity/{activity_id}` endpoint. For an outdoor activity recorded with GPS, that export carries the recorded coordinates as GPX track points; the sync still validates every export because an eligible activity may have been recorded without GPS. GPX is the safest interchange format because Gaia officially accepts it. The sync reuses `GARMIN_TOKENS`; its Gaia folder and credential are separate configuration.

Gaia does **not** publish a supported write API or OAuth flow. The automation uses Gaia's private web upload behavior with a browser-extracted `sessionid`; it is unsupported, may violate service expectations, and can break or expire without notice. The feature therefore remains opt-in and best-effort.

## Acceptance Criteria

- [ ] A standalone workflow supports nightly scheduling, manual verification runs, and enable/disable controls through GitHub Actions.
- [ ] Only exact, verified Garmin type keys for hiking and mountaineering are eligible; fixtures prove eligible and ineligible filtering.
- [ ] Each eligible activity is downloaded as GPX and is uploaded only when XML validation finds at least one valid `trkpt` latitude/longitude pair.
- [ ] Imported tracks land in the configured existing Gaia folder, and a missing or ambiguous folder fails safely without creating or choosing another folder.
- [ ] Re-running after full or partial failure creates no duplicate Gaia track; the durable identity is Garmin activity ID, not title or date.
- [ ] The Garmin activity ID is embedded in a deterministic imported-track name or description and verified to survive Gaia import; the sync checks that marker in the destination folder before uploading.
- [ ] `GARMIN_TOKENS` is reused, while Gaia session credentials and the folder identifier are stored as masked Actions secrets; neither appears in logs or artifacts.
- [ ] Authentication expiry, rate limiting, malformed/empty GPX, rejected upload, and folder-assignment failure produce a non-zero result and an actionable per-activity summary; successful tracks are not rolled back.
- [ ] Tests cover type filtering, coordinate validation, identity/idempotency, sequencing, configuration validation, and mocked Garmin/Gaia failure responses without contacting either service.
- [ ] Normal runs query a 72-hour rolling window, and a manual boolean option queries all Garmin history from 2015-01-01.

## Scope

### In scope
- A personal-account, opt-in nightly sync for new hiking and mountaineering tracks in a standalone workflow.
- Configurable Gaia destination folder, conservative request pacing, a 72-hour default lookback, a 2015 full-history backfill, and resumable/idempotent retries.
- Setup and recovery documentation, including manual Gaia session-cookie renewal and the unsupported-API warning.

### Out of scope
- Syncing other activity types, routes/waypoints/photos, or changing the Stronger UI or Sheets schema.
- Automating Gaia login, CAPTCHA/MFA, scraping browser credentials, or claiming support from Garmin/Gaia.
- Deleting or updating Gaia tracks when a Garmin activity changes; that requires a separate conflict-policy spec.

## Notes

- Existing context: `.github/workflows/garmin-sync.yml` runs hourly, but the Gaia sync reads activities directly from Garmin and does not depend on the Google Sheets write.
- **Workflow separation decision:** use a standalone `garmin-gaia-sync.yml` workflow with its own nightly cron and manual dispatch. GitHub's workflow controls replace custom enable and UTC-hour variables.
- Garmin's official Activity API confirms activity file delivery in FIT, GPX, and TCX, but access requires an approved business integration: https://developer.garmin.com/gc-developer-program/activity-api/
- The installed client family exposes `download_activity(..., ActivityDownloadFormat.GPX)` against Garmin Connect's GPX export endpoint and returns raw bytes: https://github.com/cyberjunky/python-garminconnect/blob/981d150caeda7d632224a75f3895c08df27a2a34/garminconnect/__init__.py#L2825-L2862
- Gaia officially supports manual GPX, KML/KMZ, GeoJSON, and FIT imports: https://help.gaiagps.com/hc/en-us/articles/360052763513-Import-GPX-KML-KMZ-GeoJSON-or-FIT-Files-on-gaiagps-com
- Evidence for the automated route is explicitly unofficial: `gaiagpsclient` says Gaia has no published API, uses reverse-engineered browser behavior, and requires a browser-extracted `sessionid` that must be replaced after expiry. Its upload command accepts GPX and can move imported tracks from Gaia's temporary import folder into an exact existing folder, but the project has not shipped a change since 2023: https://github.com/kk7ds/gaiagpsclient and https://github.com/kk7ds/gaiagpsclient/blob/1ba0ea4266260ff979c7df483381d01d29fae25d/gaiagps/shell/upload.py

## Implementation decisions

- The standalone workflow runs nightly at 03:00 UTC and can be enabled, disabled,
  manually run, or rescheduled through GitHub Actions without custom gate
  variables.
- Scheduled and normal manual runs upload the last 72 hours directly. The
  manual `backfill` input queries all activities from 2015-01-01.
- The sync uses the existing `requests` dependency rather than adding
  the unmaintained, non-PyPI `gaiagpsclient`. It requires an immutable
  `GAIA_FOLDER_ID`, validates that ID before upload, and never creates a folder.
- `GAIA_FOLDER_ID` is stored as an Actions secret alongside `GAIA_SESSION_ID`,
  rather than as an Actions variable.
- Every imported track title contains `[Garmin activity:<activityId>]`. Duplicate
  and partial-failure recovery checks that marker across all Gaia tracks before
  uploading, then verifies folder membership before deleting Gaia's temporary
  import folder.
- After GitHub-hosted requests received 403 responses with a freshly renewed
  session, Gaia requests were moved to the existing `curl_cffi` dependency's
  Chrome impersonation. Authentication is now checked against the protected
  folder API rather than the public profile page, and the session cookie is
  scoped to the exact `www.gaiagps.com` host used by the client.
- GPX uploads use `curl_cffi.CurlMime` rather than the Requests-compatible
  `files` argument, which `curl_cffi` deliberately does not support.
- Before uploading, the client loads Gaia's upload page to initialize the
  session's CSRF cookie, then submits that token with same-origin headers.
- The upload request reads the current file field, same-origin form action, and
  hidden inputs from Gaia's upload page rather than assuming the legacy form
  remains unchanged.
