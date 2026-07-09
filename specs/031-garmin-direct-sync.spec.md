# Feature: Direct Garmin Connect Sync

> Replace the Strava-based activity sync with a direct Garmin Connect sync, so activity data keeps flowing into the sheet now that Strava's API is no longer free.

## What

Spec [027](../.archive/specs/027-garmin-sync.spec.md) pulled Garmin activity data indirectly: Garmin auto-synced to Strava, and a GitHub Actions workflow read Strava's REST API. Strava has since closed its API behind a paid membership, so that pipeline no longer works for free.

This spec replaces the Strava hop with a direct Garmin Connect sync. A sync job authenticates to Garmin Connect using [`garth`](https://github.com/matin/garth) — the same OAuth engine that [GarminDB](https://github.com/tcgoetz/GarminDB) uses — fetches recent activities, and appends new rows to the existing activity tab in the Google Sheet via a service account. The job runs either on a scheduled GitHub Actions workflow or on any machine with `python` (local cron, home server, etc.).

The **sheet schema and app UI are unchanged**. The script writes to the same `Stronger - Strava` tab with the same 10 columns the app already reads, so the activity charts keep working with no front-end changes. Only the *source* of the data changes (Garmin instead of Strava). See "Tab naming" below for why the legacy tab name is retained.

### Why direct Garmin instead of Strava?

Strava's free API tier was removed, so the previous pipeline costs money. Garmin is the original source of the data anyway, so cutting out the Strava intermediary removes a dependency and a sync delay.

### The Garmin authentication reality

Garmin has no public developer API, and as of March 2026 the login page is protected by Cloudflare TLS fingerprinting that blocks non-browser HTTP clients (this broke fresh `garth` / `python-garminconnect` logins — see [garth#222](https://github.com/matin/garth/discussions/222)). However:

- **Token *refresh* still works** from plain HTTP clients — only the initial SSO login is blocked.
- So the flow is: perform a **one-time browser-based login** to mint `garth` OAuth tokens, save them (base64 dump), and let the sync job resume from those saved tokens. Garmin OAuth1 tokens remain valid for ~1 year, and the job refreshes the short-lived OAuth2 access token on every run.

This keeps the recurring sync fully headless (works in a GitHub Action or on a server) while confining the browser step to a rare, manual token refresh.

## Acceptance Criteria

- [ ] `scripts/garmin-sync.py` authenticates to Garmin Connect from a saved `garth` token dump (env var / file), with no interactive login at run time.
- [ ] The script fetches recent activities from Garmin Connect and maps each to the existing 10-column activity row (`date`, `id`, `activityType`, `name`, `duration`, `distance`, `elevationGain`, `calories`, `avgHR`, `maxHR`).
- [ ] New rows are appended to the `Stronger - Strava` tab via a Google service account; re-runs are idempotent (dedup by activity ID).
- [ ] The tab and header are created automatically if missing.
- [ ] A GitHub Actions workflow (`garmin-sync.yml`) runs the script on a daily cron and on `workflow_dispatch`.
- [ ] The activity→row mapping is a pure function covered by an offline unit test (no network).
- [ ] Setup instructions (`GARMIN_SYNC_SETUP.md`) cover minting the token dump via a one-time browser login and configuring secrets, plus how to run the job on a local machine.
- [ ] The obsolete Strava script, workflow, and setup doc are removed, and docs (`README.md`, `AGENTS.md`) are updated.

## Scope

### In scope
- Python sync script using `garth` for Garmin auth + activity fetch
- Reusing the existing sheet tab, columns, and Google service-account write path
- GitHub Actions workflow + the option to run on any machine
- One-time token-minting instructions (browser login) and secret configuration
- Offline unit test for the row mapping
- Removing the Strava pipeline

### Out of scope
- Renaming the sheet tab / app-side `Strava*` identifiers (kept for backward compatibility with existing spreadsheets and to keep this change surgical — a future spec can rename them)
- Automating the one-time browser login inside CI
- New activity metrics or granular data (streams, GPS, laps, sleep, body composition)
- Changing the activity charts UI

## Notes

- **Token dump**: obtained once via a browser login using a helper such as [`garth`'s login flow](https://github.com/matin/garth) or a browser-login helper, then `garth.client.dumps()` produces a base64 blob stored as the `GARMIN_TOKENS` secret. The job calls `garth.client.loads(...)` and refreshes as needed.
- **Activity endpoint**: `/activitylist-service/activities/search/activities?start=0&limit=N`. Fields used: `activityId`, `activityName`, `startTimeLocal`, `activityType.typeKey`, `duration`, `distance`, `elevationGain`, `calories`, `averageHR`, `maxHR`.
- **Dedup key**: the Garmin `activityId` is written into the existing `stravaId`/`id` column (column B). Values are unique per activity, so dedup logic is unchanged.
- **Tab naming**: the tab stays `Stronger - Strava` so existing users' spreadsheets and the app's chart code keep working untouched. The column formerly called `stravaId` now holds the Garmin activity ID; its meaning (a stable per-activity dedup key) is unchanged.
- **`garth` deprecation**: `garth` is deprecated but still functions for token refresh + API calls with saved tokens, and remains the de-facto library (GarminDB, `python-garminconnect` build on it). If it stops working, the browser-login helpers referenced above emit `garth`-compatible tokens.
