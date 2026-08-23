# Feature: Nightly Garmin-to-Gaia Track Sync

> Copy new Garmin hiking and mountaineering GPS tracks into a dedicated Gaia GPS folder each night, without duplicating tracks.

## What

After the Garmin activity sync succeeds, a nightly, opt-in sync finds new activities whose Garmin `activityType.typeKey` is `hiking` or `mountaineering`. It downloads each activity's GPX export, verifies that it contains track points with valid latitude and longitude attributes, and imports valid tracks into a configured Gaia folder. Other activity types and activities without coordinates are skipped and reported.

Garmin coordinates are feasible: Garmin's Activity API documents FIT/GPX/TCX activity files, and the already-used unofficial `python-garminconnect` client exposes `download_activity(activity_id, Garmin.ActivityDownloadFormat.GPX)`, returning the raw bytes from Garmin Connect's `/download-service/export/gpx/activity/{activity_id}` endpoint. For an outdoor activity recorded with GPS, that export carries the recorded coordinates as GPX track points; the sync still validates every export because an eligible activity may have been recorded without GPS. GPX is the safest interchange format because Gaia officially accepts it. The sync reuses `GARMIN_TOKENS`; its Gaia folder and credential are separate configuration.

Gaia does **not** publish a supported write API or OAuth flow. The only known automation path is Gaia's private web upload behavior, using a browser-extracted `sessionid`; it is unsupported, may violate service expectations, and can break or expire without notice. This feature must therefore remain opt-in and best-effort, and must not ship as enabled nightly automation until a live-account spike confirms upload, folder placement, and re-run behavior. If that gate fails, the safe fallback is to produce GPX workflow artifacts for manual import through Gaia's supported web UI—not browser automation or CAPTCHA bypass.

## Acceptance Criteria

- [ ] A manually enabled nightly job starts only after that cycle's Garmin activity sync succeeds; a failed or skipped upstream sync prevents Gaia writes.
- [ ] Only exact, verified Garmin type keys for hiking and mountaineering are eligible; fixtures prove eligible and ineligible filtering.
- [ ] Each eligible activity is downloaded as GPX and is uploaded only when XML validation finds at least one valid `trkpt` latitude/longitude pair.
- [ ] Imported tracks land in the configured existing Gaia folder, and a missing or ambiguous folder fails safely without creating or choosing another folder.
- [ ] Re-running after full or partial failure creates no duplicate Gaia track; the durable identity is Garmin activity ID, not title or date.
- [ ] The Garmin activity ID is embedded in a deterministic imported-track name or description and verified to survive Gaia import; the sync checks that marker in the destination folder before uploading.
- [ ] `GARMIN_TOKENS` is reused, while Gaia session credentials are stored only as a masked Actions secret and the folder identifier is non-secret configuration; neither appears in logs or artifacts.
- [ ] Authentication expiry, rate limiting, malformed/empty GPX, rejected upload, and folder-assignment failure produce a non-zero result and an actionable per-activity summary; successful tracks are not rolled back.
- [ ] Tests cover type filtering, coordinate validation, identity/idempotency, sequencing, configuration validation, and mocked Garmin/Gaia failure responses without contacting either service.
- [ ] Before nightly enablement, a manual live-account check demonstrates one upload into the configured folder and a duplicate-free second run; otherwise the workflow stops at downloadable GPX artifacts.

## Scope

### In scope
- A personal-account, opt-in nightly sync for new hiking and mountaineering tracks, sequenced after the existing Garmin activity sync.
- Configurable Gaia destination folder, conservative request pacing, bounded recent lookback, and resumable/idempotent retries.
- Setup and recovery documentation, including manual Gaia session-cookie renewal and the unsupported-API warning.

### Out of scope
- Backfilling all Garmin history, syncing other activity types, routes/waypoints/photos, or changing the Stronger UI or Sheets schema.
- Automating Gaia login, CAPTCHA/MFA, scraping browser credentials, or claiming support from Garmin/Gaia.
- Deleting or updating Gaia tracks when a Garmin activity changes; that requires a separate conflict-policy spec.

## Notes

- Existing context: `.github/workflows/garmin-sync.yml` currently runs hourly and `scripts/garmin-sync.py` fetches 30 recent activities with `GARMIN_TOKENS`, deduplicating Sheet rows by `activityId`. The new nightly stage must not infer completion merely from wall-clock ordering.
- **Sequencing decision:** add the Gaia stage as a dependent job in the existing hourly workflow (`needs: sync`), gated to one configured UTC hour on scheduled runs while remaining manually dispatchable. A separate nightly cron would only approximate ordering and could race the Garmin job.
- Garmin's official Activity API confirms activity file delivery in FIT, GPX, and TCX, but access requires an approved business integration: https://developer.garmin.com/gc-developer-program/activity-api/
- The installed client family exposes `download_activity(..., ActivityDownloadFormat.GPX)` against Garmin Connect's GPX export endpoint and returns raw bytes: https://github.com/cyberjunky/python-garminconnect/blob/981d150caeda7d632224a75f3895c08df27a2a34/garminconnect/__init__.py#L2825-L2862
- Gaia officially supports manual GPX, KML/KMZ, GeoJSON, and FIT imports: https://help.gaiagps.com/hc/en-us/articles/360052763513-Import-GPX-KML-KMZ-GeoJSON-or-FIT-Files-on-gaiagps-com
- Evidence for the only known automated route is explicitly unofficial: `gaiagpsclient` says Gaia has no published API, uses reverse-engineered browser behavior, and requires a browser-extracted `sessionid` that must be replaced after expiry. Its upload command accepts GPX and can move imported tracks from Gaia's temporary import folder into an exact existing folder, but the project has not shipped a change since 2023, so it is evidence for a spike rather than a dependable supported dependency: https://github.com/kk7ds/gaiagpsclient and https://github.com/kk7ds/gaiagpsclient/blob/1ba0ea4266260ff979c7df483381d01d29fae25d/gaiagps/shell/upload.py
- **Unresolved blocker:** Gaia's private upload/folder endpoints, session lifetime, terms compatibility, and stable machine-readable identity are undocumented. Owner approval and the live spike are required before enabling writes; folder lookup should prefer a configured immutable ID if Gaia exposes and validates one, otherwise an exact unique name.
