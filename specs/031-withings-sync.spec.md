# Feature: Withings Body Composition Sync

> Pull body-composition data (weight, body fat, muscle mass, bone mass, hydration) from the Withings public API into a new Google Sheet tab, and surface it in-app as trend charts — much like the existing Strava activity sync.

## What

Withings scales upload measurements to a user's Withings account, and Withings exposes an official OAuth2 REST API. A scheduled GitHub Actions workflow uses the Withings `getmeas` endpoint to fetch recent measurements, then writes them to a new "Stronger - Withings" tab in the Google Sheet. This keeps body-composition data flowing into the sheet-based data model without a backend, mirroring the Strava pipeline.

A Node.js script refreshes the Withings access token, fetches measurement groups, decodes them, deduplicates by measurement group ID, and appends new rows via a Google service account. The workflow runs daily on a cron schedule and can also be triggered manually. The app reads the tab lazily when the Body Composition view is opened and renders one trend line per available metric.

### The rotating refresh token

Unlike Strava (whose refresh tokens never expire), **Withings rotates its refresh token on every refresh** — each token exchange invalidates the previous refresh token (it stops working ~8 hours later) and returns a new one. A stateless cron reading a fixed repo secret would work exactly once and then break.

To survive, the script persists the current refresh token in a **"Stronger - Infra"** key/value tab in the same spreadsheet: it reads the token at the start of each run and writes the rotated token back immediately after a successful refresh. The `WITHINGS_REFRESH_TOKEN` secret is only the initial seed, used before the Infra tab holds a token.

### Read-only by design

The one-time authorization requests only the `user.metrics` scope — read access to measurements. The sync never writes to the user's Withings account.

## Acceptance Criteria

- [ ] A new GitHub Actions workflow (`withings-sync.yml`) runs on a daily cron schedule and on `workflow_dispatch`
- [ ] The workflow authenticates with Withings using an OAuth2 refresh token, persisting the rotated token in the "Stronger - Infra" tab
- [ ] The workflow fetches recent measurements from the Withings `getmeas` API (weight, fat mass, fat ratio, muscle mass, bone mass, hydration)
- [ ] Measurement values are decoded using the Withings `value × 10^unit` encoding
- [ ] New rows are appended to a "Stronger - Withings" tab via a service account
- [ ] Duplicate rows (same Withings measurement group ID) are not created on re-runs — the sync is idempotent
- [ ] The sheet tab has a clear header row with descriptive column names
- [ ] A `WITHINGS_SYNC_RANGE` and header constant are added for the new tab
- [ ] The app can read and deserialize rows from the tab (type definitions + parse function)
- [ ] The app renders a "Body Composition" view with a trend line per metric, a time-range selector, a day/week/month aggregation toggle, and optional per-metric targets
- [ ] Body-composition targets persist in the Settings tab under a `bodyGoal.*` prefix, distinct from Strava's `goal.*` keys

## Scope

### In scope
- GitHub Actions workflow for scheduled sync
- Withings OAuth2 token refresh with rotating-token persistence
- Body-composition measurements: weight, fat mass, fat ratio, muscle mass, bone mass, hydration
- Writing to a new Google Sheet tab via service account
- TypeScript types and sheet config for reading the tab
- In-app trend charts (line-per-metric), time range + aggregation controls, per-metric targets
- One-time Withings OAuth2 setup instructions

### Out of scope
- Activity, sleep, heart-rate, blood-pressure, or SpO2 data from Withings (only body composition)
- Withings Notify/webhook push subscriptions (polling on a cron is sufficient)
- Two-way sync (writing back to Withings)
- Imperial-unit display (values stored and shown in kg / %)

## Notes

- **Meastype codes**: weight=1, fatRatio=6, fatMass=8, muscleMass=76, hydration=77, boneMass=88. See [Withings — all available health data](https://developer.withings.com/developer-guide/v3/data-api/all-available-health-data/).
- **Token endpoint**: `POST https://wbsapi.withings.net/v2/oauth2` with `action=requesttoken`. Responses wrap data under a `body` key with `status: 0` on success.
- **Measure endpoint**: `POST https://wbsapi.withings.net/measure` with `action=getmeas`. Each `measuregrp` has a unix `date`, a `grpid` (used for dedup), and a `measures` array of `{ value, type, unit }`.
- **Value encoding**: real value = `value × 10^unit` (e.g. `7500 × 10^-2 = 75.00 kg`).
- **Idempotency**: read existing group IDs from the sheet, only append groups whose `grpid` is new. A 60-day lookback per run gives ample overlap.
- **Column layout**: `date`, `grpId`, `weight`, `fatMass`, `fatRatio`, `muscleMass`, `boneMass`, `hydration`. Weight is the one required field; body-composition columns are blank when a scale doesn't measure them.
- **Service account**: same as the Strava sync — reuse `GOOGLE_SERVICE_ACCOUNT_KEY` and `SPREADSHEET_ID`.
- **Cron offset**: runs at 06:30 UTC, 30 minutes after the Strava sync, to avoid two jobs racing on the same spreadsheet.
