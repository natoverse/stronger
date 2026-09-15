# Feature: Garmin Data Sync via Strava

> Historical feature: pull Garmin activity and fitness data through the Strava API for display alongside manually logged workouts.

This indirect pipeline was retired in favor of [direct Garmin Connect synchronization](031-garmin-direct-sync.spec.md). Provider and activity-model decisions remain below as historical context; current persistence is defined in [direct Firestore sync](../../specs/052-direct-firestore-sync-actions.spec.md).

## What

Garmin auto-syncs activities to Strava, which exposes an OAuth2 REST API. The original scheduled workflow fetched recent Strava activities and stored them as application activity history without manual exports or reverse-engineered auth.

The workflow authenticated with Strava using a refresh token stored in repo secrets. A Node.js script refreshed the access token, fetched activity summaries, and appended new activity records. The workflow ran daily and supported manual dispatch.

The app loaded activity history alongside other application data. This spec covered only the data pipeline; displaying the data was deferred.

### Why Strava instead of Garmin directly?

Garmin has no public API for individual developers. The unofficial SSO approach used by garth/garmindb was [deprecated in March 2026](https://github.com/matin/garth/discussions/222) after Garmin added Cloudflare TLS fingerprinting that blocks third-party clients. Strava's API is official, stable, and well-documented. Since Garmin → Strava auto-sync is a standard feature, the data arrives in Strava within minutes of a Garmin activity.

## Acceptance Criteria

- [ ] A new GitHub Actions workflow (`garmin-sync.yml`) runs on a daily cron schedule and on `workflow_dispatch`
- [ ] The workflow authenticates with Strava using an OAuth2 refresh token (repo secret)
- [ ] The workflow fetches recent activities from the Strava API (date, activity type, duration, distance, calories, avg heart rate, elevation gain)
- [ ] New records are appended to the user's activity history
- [ ] Duplicate rows (same Strava activity ID) are not created on re-runs — the sync is idempotent
- [ ] Activity records use descriptive field names
- [ ] The app can read activity records into its shared model

## Scope

### In scope
- GitHub Actions workflow for scheduled sync
- Strava OAuth2 token refresh via repo secrets
- Activity summary data from Strava (date, type, name, duration, distance, calories, avg HR, elevation gain)
- Persisting activity history
- TypeScript types for reading activity records in the app
- One-time Strava OAuth2 setup instructions (get initial refresh token)

### Out of scope
- UI for displaying Garmin/Strava data (future spec)
- Granular data (per-second HR, GPS tracks, lap splits, streams)
- Two-way sync (writing back to Strava or Garmin)
- Body composition data (weight, body fat — not available via Strava)
- Sleep data, stress data, daily steps
- Direct Garmin Connect integration (blocked by Garmin)

## Notes

- **Strava OAuth2 setup**: One-time manual step. Create a Strava API app at [strava.com/settings/api](https://www.strava.com/settings/api), authorize with the `read,activity:read` scopes, capture the refresh token. Store `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_REFRESH_TOKEN` as repo secrets. The workflow refreshes the access token on each run — refresh tokens don't expire.
- **Strava API rate limits**: 100 requests per 15 minutes, 1000 per day. Fetching the last 30 activities per run is well within limits.
- **Idempotency**: Check stored Strava activity IDs and only append new records.
- **Activity fields**: The original model retained `date`, `stravaId`, `activityType`, `name`, `duration`, `distance`, `elevationGain`, `calories`, `avgHR`, and `maxHR` from Strava's `SummaryActivity` response.
- **Garmin → Strava delay**: Activities typically appear in Strava within 5-10 minutes of syncing from the watch. The daily cron schedule means data is never more than ~24h behind.
