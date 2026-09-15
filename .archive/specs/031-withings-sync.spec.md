# Feature: Withings Body Composition Sync

> Pull body-composition data (weight, body fat, muscle mass, bone mass, hydration) from the Withings public API into Firestore and surface it in-app as trend charts.

## What

Withings scales upload measurements to a user's Withings account, and Withings exposes an official OAuth2 REST API. A scheduled GitHub Actions workflow uses the Withings `getmeas` endpoint to fetch recent measurements, then writes them to yearly `/users/{uid}/withingsMeasurements/{year}` buckets in Firestore.

A Node.js script refreshes the Withings access token, fetches measurement groups, decodes them, deduplicates by measurement group ID, and persists entries via a Firebase service account. The workflow runs daily and supports manual dispatch. The app loads the measurement buckets for body-composition charts and renders one trend line per available metric.

### The rotating refresh token

Unlike Strava (whose refresh tokens never expire), **Withings rotates its refresh token on every refresh** — each token exchange invalidates the previous refresh token (it stops working ~8 hours later) and returns a new one. A stateless cron reading a fixed repo secret would work exactly once and then break.

The script persists the current refresh token in the administrator-only Firestore document **`/syncState/{uid}`**: it reads the token at the start of each run and writes the rotated token immediately after successful refresh, before fetching measurements. The `WITHINGS_REFRESH_TOKEN` secret is only the initial seed, used before that document holds a token. Browser clients cannot access this document.

### Read-only by design

The one-time authorization requests only the `user.metrics` scope — read access to measurements. The sync never writes to the user's Withings account.

## Acceptance Criteria

- [ ] A new GitHub Actions workflow (`withings-sync.yml`) runs on a daily cron schedule and on `workflow_dispatch`
- [ ] The workflow authenticates with Withings using an OAuth2 refresh token, persisting the rotated token in `/syncState/{uid}`
- [ ] The workflow fetches recent measurements from the Withings `getmeas` API (weight, fat mass, fat ratio, muscle mass, bone mass, hydration)
- [ ] Measurement values are decoded using the Withings `value × 10^unit` encoding
- [ ] Measurements are written to yearly Firestore buckets via a Firebase service account
- [ ] Duplicate rows (same Withings measurement group ID) are not created on re-runs — the sync is idempotent
- [ ] Measurement objects use descriptive named fields
- [ ] The app reads measurement entries into the shared body-composition model
- [ ] The app renders a "Body Composition" view with a trend line per metric, a time-range selector, a day/week/month aggregation toggle, and optional per-metric targets
- [ ] Body-composition targets persist in Firestore settings under a `bodyGoal.*` prefix, distinct from activity `goal.*` keys

## Scope

### In scope
- GitHub Actions workflow for scheduled sync
- Withings OAuth2 token refresh with rotating-token persistence
- Body-composition measurements: weight, fat mass, fat ratio, muscle mass, bone mass, hydration
- Writing yearly Firestore measurement buckets via a Firebase service account
- TypeScript types and adapters for reading measurement entries
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
- **Idempotency**: match existing entries by `grpId`; append mode skips existing IDs and overwrite mode refreshes matching entries. A 60-day lookback per run gives ample overlap.
- **Measurement fields**: `date`, `grpId`, `weight`, `fatMass`, `fatRatio`, `muscleMass`, `boneMass`, `hydration`. Weight is required; unavailable optional measurements use `null`. Later additions are recorded in spec 032.
- **Service account**: use `FIREBASE_SERVICE_ACCOUNT_KEY` and `FIREBASE_USER_ID`, as in the Garmin pipelines.
- **Cron offset**: runs at 06:30 UTC, retaining the original staggered schedule.

## Iteration decisions

- The Firestore backend retains the original one-time OAuth setup
  instructions. `WITHINGS_SYNC_SETUP.md` documents creating a Public API
  integration, authorizing the read-only `user.metrics` scope, exchanging the
  short-lived authorization code, and saving the returned refresh token as the
  initial `WITHINGS_REFRESH_TOKEN` seed.
- **Firestore-only (2026-09-15):** Measurement entries are mapped directly into named fields and yearly buckets; provider refresh tokens stay in administrator-only sync state. The signed nonce/HMAC authorization protocol, token-rotation ordering, retries, and overwrite/backfill semantics in spec 052 remain in force.
