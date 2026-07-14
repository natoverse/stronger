# Feature: Direct Garmin Connect Sync

> Replace the Strava-based activity sync with a direct Garmin Connect sync, so activity data keeps flowing into the sheet now that Strava's API is no longer free.

## What

Spec [027](../.archive/specs/027-garmin-sync.spec.md) pulled Garmin activity data indirectly: Garmin auto-synced to Strava, and a GitHub Actions workflow read Strava's REST API. Strava has since closed its API behind a paid membership, so that pipeline no longer works for free.

This spec replaces the Strava hop with a direct Garmin Connect sync. A sync job authenticates to Garmin Connect using [`garth`](https://github.com/matin/garth) — the same OAuth engine that [GarminDB](https://github.com/tcgoetz/GarminDB) uses — fetches recent activities, and appends new rows to a dedicated `Stronger - Garmin` tab in the Google Sheet via a service account. The job runs either on a scheduled GitHub Actions workflow or on any machine with `python` (local cron, home server, etc.).

Garmin exposes richer per-activity metrics than Strava did, so the new tab uses a **Garmin-native schema** rather than being constrained to Strava's columns (it adds moving duration, elevation loss, average/max speed, steps, aerobic/anaerobic training effect, and VO2 max). The legacy `Stronger - Strava` tab and its app view are left in place and **deprecated gradually** — the activity view is migrated to the Garmin tab in a follow-up, so this spec covers only the data pipeline and the new tab schema.

### Why direct Garmin instead of Strava?

Strava's free API tier was removed, so the previous pipeline costs money. Garmin is the original source of the data anyway, so cutting out the Strava intermediary removes a dependency and a sync delay.

### The Garmin authentication reality

Garmin has no public developer API, and as of March 2026 the login page is protected by Cloudflare TLS fingerprinting that blocks non-browser HTTP clients (this broke fresh `garth` / `python-garminconnect` logins — see [garth#222](https://github.com/matin/garth/discussions/222)). However:

- **Token *refresh* still works** from plain HTTP clients — only the initial SSO login is blocked.
- So the flow is: perform a **one-time browser-based login** to mint `garth` OAuth tokens, save them (base64 dump), and let the sync job resume from those saved tokens. Garmin OAuth1 tokens remain valid for ~1 year, and the job refreshes the short-lived OAuth2 access token on every run.

This keeps the recurring sync fully headless (works in a GitHub Action or on a server) while confining the browser step to a rare, manual token refresh.

## Acceptance Criteria

- [ ] `scripts/garmin-sync.py` authenticates to Garmin Connect from a saved `garth` token dump (env var / file), with no interactive login at run time.
- [ ] The script fetches recent activities from Garmin Connect and maps each to the Garmin-native activity row (`date`, `activityId`, `activityType`, `name`, `duration`, `movingDuration`, `distance`, `elevationGain`, `elevationLoss`, `calories`, `avgHR`, `maxHR`, `avgSpeed`, `maxSpeed`, `steps`, `aerobicTE`, `anaerobicTE`, `vo2Max`).
- [ ] New rows are appended to a dedicated `Stronger - Garmin` tab via a Google service account; re-runs are idempotent (dedup by activity ID).
- [ ] The tab and header are created automatically if missing.
- [ ] A GitHub Actions workflow (`garmin-sync.yml`) runs the script on a daily cron and on `workflow_dispatch`.
- [ ] The activity→row mapping is a pure function covered by an offline unit test (no network).
- [ ] Setup instructions (`GARMIN_SYNC_SETUP.md`) cover minting the token dump via a one-time browser login and configuring secrets, plus how to run the job on a local machine.
- [ ] The obsolete Strava script, workflow, and setup doc are removed, and docs (`README.md`, `AGENTS.md`) are updated.

## Scope

### In scope
- Python sync script using `garth` for Garmin auth + activity fetch
- A new `Stronger - Garmin` tab with a Garmin-native (richer) schema, written via the Google service-account path
- GitHub Actions workflow + the option to run on any machine
- One-time token-minting instructions (browser login) and secret configuration
- Offline unit test for the row mapping
- Removing the Strava pipeline (script, workflow, setup doc)

### Out of scope
- Migrating the app's activity view/charts to read the `Stronger - Garmin` tab — done in a follow-up as the Strava view is deprecated gradually
- Removing the app-side `Strava*` code and the `Stronger - Strava` tab (deprecated over time, not deleted here)
- Automating the one-time browser login inside CI
- Granular data (streams, GPS, laps, sleep, body composition)

## Notes

- **Token dump**: obtained once via a browser login using a helper such as [`garth`'s login flow](https://github.com/matin/garth) or a browser-login helper, then `garth.client.dumps()` produces a base64 blob stored as the `GARMIN_TOKENS` secret. The job calls `garth.client.loads(...)` and refreshes as needed.
- **Activity endpoint**: `/activitylist-service/activities/search/activities?start=0&limit=N`. Fields used: `activityId`, `activityName`, `startTimeLocal`, `activityType.typeKey`, `duration`, `movingDuration`, `distance`, `elevationGain`, `elevationLoss`, `calories`, `averageHR`, `maxHR`, `averageSpeed`, `maxSpeed`, `steps`, `aerobicTrainingEffect`, `anaerobicTrainingEffect`, `vO2MaxValue`.
- **Dedup key**: the Garmin `activityId` is written into column B and used for deduplication. Values are unique per activity.
- **Tab naming**: a new tab `Stronger - Garmin` (18 columns, `A:R`) holds the data. The old `Stronger - Strava` tab is left untouched and phased out as the app view is migrated.
- **`garth` deprecation**: `garth` is deprecated but still functions for token refresh + API calls with saved tokens, and remains the de-facto library (GarminDB, `python-garminconnect` build on it). If it stops working, the browser-login helpers referenced above emit `garth`-compatible tokens.

> **Superseded — see iteration log below.** `garth`'s login broke and the library was abandoned; the sync now uses `python-garminconnect`, which no longer depends on `garth`.

## Iteration log

- **Reviewer redirect (PR feedback):** The initial implementation reused the legacy `Stronger - Strava` tab and its 10 columns to avoid touching the app. On review, @natoverse noted the sync need not be constrained by the Strava data model since Garmin's is more comprehensive, and approved creating a new Garmin sheet/view with the Strava one deprecated gradually. The sync was updated to write a dedicated `Stronger - Garmin` tab with a richer Garmin-native schema; the app view migration is deferred to a follow-up.

- **Migrated off `garth` to `python-garminconnect`:** The original design leaned on `garth` for Garmin auth, on the premise that it was the de-facto engine GarminDB and `python-garminconnect` built on, and that only its *initial* SSO login (not token refresh) was blocked by Garmin's March 2026 Cloudflare fingerprinting. That premise no longer holds: `garth`'s login broke and the library was **deprecated/abandoned** upstream, making even the one-time token mint fail locally. The ecosystem moved on — [GarminDB](https://github.com/tcgoetz/GarminDB) now pins `garminconnect` (`python-garminconnect`), which reimplemented auth on `curl_cffi` TLS impersonation and restored fully **headless** logins (no browser-login helper needed). We migrated the sync accordingly: `scripts/requirements.txt` now uses `garminconnect>=0.3.4` + `curl_cffi>=0.15.0` (the `0.15.0` floor picks up the redirect-SSRF fix), and `scripts/garmin-sync.py` authenticates via `garminconnect.Garmin().login(<token dir>)`, resuming from a saved `garmin_tokens.json` bundle and fetching via `get_activities(0, limit)`. The activity-list fields are unchanged (same Garmin endpoint), so the pure `activity_to_row` mapping and its offline tests are untouched. **Migration cost:** existing `GARMIN_TOKENS` secrets minted with `garth` are not compatible with `garminconnect` and must be re-minted once (see `GARMIN_SYNC_SETUP.md` Step 1).
