# Feature: Garmin HRV Baseline Range

## What

Garmin Connect calculates a personal balanced HRV range from recent history.
Sync the lower and upper bounds into Firestore Garmin wellness entries
and show that range as a shaded band behind the existing HRV chart.

## Availability

The existing `get_hrv_data(cdate)` response includes the range under:

```text
hrvSummary
  └─ baseline
       ├─ balancedLow
       └─ balancedUpper
```

No additional Garmin API request is required.

## Decisions

- Add optional `hrvBaselineMin` and `hrvBaselineMax` named fields to wellness entries.
- Missing baseline data remains `null` and does not prevent other daily wellness
  values from syncing.
- Aggregate each baseline bound by averaging it within week and month buckets,
  matching the existing HRV weekly-average aggregation.
- Keep the existing HRV status dot colors and render the baseline as the same
  translucent gray per-bucket band and boundary lines used by load-focus charts.
- Include the baseline range in the chart summary and hover tooltip when it is
  available.

## Acceptance criteria

- The wellness sync extracts `baseline.balancedLow` and
  `baseline.balancedUpper` from the HRV summary.
- The sync mapping, Firestore entry, and TypeScript model all include the two
  optional fields.
- The HRV chart displays the baseline band without changing HRV status colors.
- Missing or partial baseline values render safely.
- Python extraction, Firestore mapping, aggregation, and chart behavior have
  regression coverage.
