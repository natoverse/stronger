# Feature: Direct Garmin Connect Sync

> Replace the Strava-based activity sync with direct Garmin Connect synchronization and persist activity history in Firestore.

## What

Spec [027](027-garmin-sync.spec.md) pulled Garmin activity data indirectly: Garmin auto-synced to Strava, and a GitHub Actions workflow read Strava's REST API. Strava has since closed its API behind a paid membership, so that pipeline no longer works for free.

This spec replaces the Strava hop with a direct Garmin Connect sync. A sync job authenticates to Garmin Connect, fetches recent activities, and writes yearly Firestore activity buckets via a Firebase service account. The original `garth` authentication design was superseded by `python-garminconnect` (see iteration history below). The job runs either on a scheduled GitHub Actions workflow or on any machine with `python` (local cron, home server, etc.).

Garmin exposes richer per-activity metrics than Strava did, including moving duration, elevation loss, average/max speed, steps, training effect, and VO2 max. The original implementation established Garmin-native mapping rather than constraining extraction to the intermediary's model. Current Firestore activity buckets store the shared subset consumed by the UI; see [direct Firestore synchronization](../../specs/052-direct-firestore-sync-actions.spec.md). The Strava pipeline has been retired.

### Why direct Garmin instead of Strava?

Strava's free API tier was removed, so the previous pipeline costs money. Garmin is the original source of the data anyway, so cutting out the Strava intermediary removes a dependency and a sync delay.

### The Garmin authentication reality

Garmin has no public developer API, and as of March 2026 the login page is protected by Cloudflare TLS fingerprinting that blocks non-browser HTTP clients (this broke fresh `garth` / `python-garminconnect` logins — see [garth#222](https://github.com/matin/garth/discussions/222)). However:

- **Token *refresh* still works** from plain HTTP clients — only the initial SSO login is blocked.
- So the flow is: perform a **one-time browser-based login** to mint `garth` OAuth tokens, save them (base64 dump), and let the sync job resume from those saved tokens. Garmin OAuth1 tokens remain valid for ~1 year, and the job refreshes the short-lived OAuth2 access token on every run.

This keeps the recurring sync fully headless (works in a GitHub Action or on a server) while confining the browser step to a rare, manual token refresh.

## Acceptance Criteria

- [ ] `scripts/garmin-sync.py` authenticates to Garmin Connect from a saved `python-garminconnect` token bundle, with no interactive login at run time.
- [ ] The script fetches recent Garmin activities and maps the shared UI fields, including timestamp, source ID, type, name, duration, distance, elevation gain/loss, calories, and heart rate.
- [ ] Entries are written to `/users/{uid}/garminActivities/{year}` via a Firebase service account; re-runs are idempotent by activity ID.
- [ ] Missing yearly buckets are created automatically.
- [ ] A GitHub Actions workflow (`garmin-sync.yml`) runs the script on an hourly cron and on `workflow_dispatch`.
- [ ] Activity mapping is a pure function covered by offline unit tests (no network).
- [ ] Setup instructions (`GARMIN_SYNC_SETUP.md`) cover minting the token dump via a one-time browser login and configuring secrets, plus how to run the job on a local machine.
- [ ] The obsolete Strava script, workflow, and setup doc are removed, and docs (`README.md`, `AGENTS.md`) are updated.

## Scope

### In scope
- Python sync script using `python-garminconnect` for Garmin auth and activity fetch
- Direct Firestore persistence with Firebase service-account credentials
- GitHub Actions workflow + the option to run on any machine
- One-time token-minting instructions (browser login) and secret configuration
- Offline unit tests for activity mapping
- Removing the Strava pipeline (script, workflow, setup doc)

### Out of scope
- Reworking the app's shared activity charts — subsequent UI integration is recorded below
- Renaming the app-side `Strava*` shared model/chart terminology
- Automating the one-time browser login inside CI
- Granular data (streams, GPS, laps, sleep, body composition)

## Notes

- **Token dump**: obtained once via a browser login using a helper such as [`garth`'s login flow](https://github.com/matin/garth) or a browser-login helper, then `garth.client.dumps()` produces a base64 blob stored as the `GARMIN_TOKENS` secret. The job calls `garth.client.loads(...)` and refreshes as needed.
- **Activity endpoint**: `/activitylist-service/activities/search/activities?start=0&limit=N`. Fields used: `activityId`, `activityName`, `startTimeLocal`, `activityType.typeKey`, `duration`, `movingDuration`, `distance`, `elevationGain`, `elevationLoss`, `calories`, `averageHR`, `maxHR`, `averageSpeed`, `maxSpeed`, `steps`, `aerobicTrainingEffect`, `anaerobicTrainingEffect`, `vO2MaxValue`.
- **Dedup key**: the Garmin `activityId` is retained as `stravaId` in the shared activity object. Values are unique per activity.
- **Storage**: yearly buckets contain `{ period, count, entries, updatedAt }`; activity entries use `timestamp` for bucketing and ordering.
- **`garth` deprecation**: `garth` is deprecated but still functions for token refresh + API calls with saved tokens, and remains the de-facto library (GarminDB, `python-garminconnect` build on it). If it stops working, the browser-login helpers referenced above emit `garth`-compatible tokens.

> **Superseded — see iteration log below.** `garth`'s login broke and the library was abandoned; the sync now uses `python-garminconnect`, which no longer depends on `garth`.

## Iteration log

- **Reviewer redirect (PR feedback):** The initial implementation reused the ten-field Strava model to avoid touching the app. On review, @natoverse noted that Garmin's more comprehensive data should not be constrained by the intermediary. A richer Garmin-native extraction model and a separate Garmin view were approved, with the old view retired gradually.

- **Migrated off `garth` to `python-garminconnect`:** The original design leaned on `garth` for Garmin auth, on the premise that it was the de-facto engine GarminDB and `python-garminconnect` built on, and that only its *initial* SSO login (not token refresh) was blocked by Garmin's March 2026 Cloudflare fingerprinting. That premise no longer holds: `garth`'s login broke and the library was **deprecated/abandoned** upstream, making even the one-time token mint fail locally. The ecosystem moved on — [GarminDB](https://github.com/tcgoetz/GarminDB) now pins `garminconnect` (`python-garminconnect`), which reimplemented auth on `curl_cffi` TLS impersonation and restored fully **headless** logins (no browser-login helper needed). We migrated the sync accordingly: `scripts/requirements.txt` now uses `garminconnect>=0.3.4` + `curl_cffi>=0.15.0` (the `0.15.0` floor picks up the redirect-SSRF fix), and `scripts/garmin-sync.py` authenticates via `garminconnect.Garmin().login(<token dir>)`, resuming from a saved `garmin_tokens.json` bundle and fetching via `get_activities(0, limit)`. The activity-list fields were unchanged (same Garmin endpoint), so the provider-mapping behavior and its offline tests were preserved. **Migration cost:** existing `GARMIN_TOKENS` secrets minted with `garth` are not compatible with `garminconnect` and must be re-minted once (see `GARMIN_SYNC_SETUP.md` Step 1).

- **History backfill:** the scheduled sync only fetches the most recent activities (`get_activities(0, ACTIVITY_LIMIT)`), which is all the cron needs. To load older history, `scripts/garmin-sync.py` accepts a `--backfill` flag (modeled on the Withings sync): when passed, it fetches every activity since `BACKFILL_START_DATE` (`2021-01-01`, matching the in-app year picker and the Withings backfill start) via `get_activities_by_date(start, today)`. Garmin Connect keeps full history, so there's no hard limit on how far back this reaches. Dedup by activity ID keeps backfills idempotent. `garmin-sync.yml` exposes a boolean `backfill` `workflow_dispatch` input that passes `--backfill` to the script. See `GARMIN_SYNC_SETUP.md` → "Backfilling older history".

- **App Garmin view (activity-view migration follow-up):** The deferred view mapped Garmin's shared activity subset onto the existing `StravaActivity` shape so established charts could render unchanged. Garmin type keys are title-cased, with `strength_training` mapped to `Weight Training` for consistent cardio/strength classification. The original `#/garmin` route and Watch toolbar icon supported side-by-side UI comparison using `StravaView`; later consolidation is recorded below.

- **Garmin activity tab consolidation (2026-07-18):** after comparing the merged Garmin page in practice, the activity-specific UI was moved onto the separate `#/garmin-activities` tab so the searchable activity log and cardio / strength charts live together. The `#/garmin` route now focuses on wellness-only charts, while the toolbar icon for that page switched from Watch to Heart Pulse to better reflect the remaining content.

- **Garmin activity time-window consistency (2026-07-18):** the searchable activity log on `#/garmin-activities` now receives the same range-filtered activity subset as the charts, so changing the Month / Year / calendar-year buttons narrows both the graphs and the list instead of leaving the list on full history.

- **Activity log filter defaults (2026-07-31):** the activity-type filter now initially selects every available activity type except `Weight Training`. This keeps the log focused on non-strength activities while allowing users to explicitly include strength sessions when needed.

- **Activity card elevation loss (2026-08-09):** Garmin activity mapping retains `elevationLoss`, and activity cards display it immediately after elevation gain when the loss is greater than zero.

- **Activity date-range boundary (2026-08-13):** Backfill activity queries now set their end date to the following calendar day. This makes the end bound safely inclusive of the current day when Garmin interprets its date-only range in UTC, avoiding omissions for activities near the UTC rollover.

- **Hourly activity sync (2026-08-15):** Changed the scheduled Garmin activity sync from daily at 06:00 UTC to hourly on the hour, matching the Garmin wellness sync cadence so newly uploaded activities reach the app sooner. Manual dispatch and overwrite behavior are unchanged.

- **Concise activity card metrics (2026-08-15):** Activity-card durations now use `hh:mm`, distances attach `mi` directly to the value, and elevation gain/loss use `‘` instead of `ft`. These shorter labels reduce wrapping and keep cards compact.

- **Activity log search scope (2026-08-23):** The Garmin activity log now receives the full activity history rather than the chart's selected time window. The range controls still scope the charts, while search and activity-type filtering can find any synced activity.

- **Full-history start date (2026-08-23):** The Garmin activity sync's `--backfill` option now fetches activities from 2015-01-01 instead of 2021-01-01, matching the earliest year available in the activity view.

- **Firestore-only (2026-09-15):** Direct writes require `FIREBASE_SERVICE_ACCOUNT_KEY` and `FIREBASE_USER_ID`. Named activity fields feed yearly buckets directly, without positional row adapters or an intermediary datastore. Append, overwrite, backfill, concurrency safeguards, and provider authentication remain unchanged.
