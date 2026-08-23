# Feature: Hevy CSV import

> Let users migrate their workout history from Hevy by importing its CSV export directly into the Stronger log sheet.

## What

Many potential users already have months or years of training data in Hevy. The biggest barrier to switching is losing that history — especially per-exercise trends that power the progress charts. This spec adds a one-shot import flow that reads a Hevy CSV export and appends every row to the Stronger log tab, making all historical data immediately available for progress tracking.

The goal is exercise-level history, not workout recreation. We don't need to reverse-engineer Hevy's workout templates into Stronger workout definitions — just get every logged set into our log format so the progress charts, calendar history, and exercise-level queries work with the imported data.

The import lives behind a new **Settings** view, accessed from the nav bar. Settings is a lightweight container for infrequently-used tools; Hevy import is the first item, but the view should be structured so future tools (e.g., data export, bulk edit) can slot in easily.

## Hevy CSV format

Hevy's CSV export contains one row per set with these columns:

| Column | Example |
|--------|---------|
| `Workout Name` | Push Day |
| `Workout Start` | 2025-01-15 08:30:00 |
| `Workout End` | 2025-01-15 09:45:00 |
| `Workout Notes` | Felt strong today |
| `Exercise Name` | Bench Press (Barbell) |
| `Set Order` | 1 |
| `Weight (kg)` | 90 |
| `Reps` | 6 |
| `Distance (meters)` | *(empty or number)* |
| `Seconds` | *(empty or number)* |
| `Weight System` | metric |
| `Set Type` | normal |
| `Exercise Category` | Barbell |
| `Exercise Comments` | *(optional)* |
| `Rest Time` | *(optional)* |
| `Workout Duration` | 75 min |
| `Workout Date` | 2025-01-15 |

## Mapping to Stronger log format

| Stronger column | Source | Notes |
|-----------------|--------|-------|
| `date` | `Workout Date` or parse from `Workout Start` | Format as YYYY-MM-DD |
| `startTime` | `Workout Start` | Convert to ISO 8601 |
| `endTime` | `Workout End` | Convert to ISO 8601 |
| `workoutId` | Slugified `Workout Name` | e.g., "Push Day" → "push-day" |
| `exerciseName` | `Exercise Name` | Use as-is from Hevy |
| `liftId` | Slugified `Exercise Name` | e.g., "Bench Press (Barbell)" → "bench-press-barbell" |
| `setNumber` | `Set Order` | 1-based integer, use as-is |
| `setType` | `Set Type` | Map Hevy values: `"warmup"` → `"warmup"`, `"normal"` → `"work"`. Default unknown values to `"work"`. |
| `plannedWeight` | Same as `actualWeight` | Hevy doesn't track planned vs. actual |
| `plannedReps` | Same as `actualReps` | Same reason |
| `actualWeight` | `Weight (kg)` | Convert kg → lbs if metric (× 2.20462), round to nearest 0.5 |
| `actualReps` | `Reps` | Use as-is |
| `completed` | `TRUE` | If it was logged, it was completed |
| `category` | Infer from row content | If `Distance (meters)` or `Seconds` is populated and `Weight (kg)` is empty → `"cardio"`, otherwise `"strength"` |
| `duration` | `Seconds` ÷ 60 | Only for cardio rows; convert seconds to minutes |
| `distance` | `Distance (meters)` ÷ 1609.34 | Only for cardio rows; convert meters to miles |
| `elevation` | `""` | Not available in Hevy export |
| `cardioWeight` | `""` | Not available in Hevy export |

## Flow

1. User navigates to Settings (new nav icon).
2. User taps "Import from Hevy" section.
3. Brief instructions explain how to export from Hevy (Profile → Settings → Export & Import Data → Export Workouts).
4. User selects CSV file via file picker (`<input type="file">`).
5. App parses the CSV client-side and shows a summary: date range, total sets, unique exercises, and number of workouts found.
6. User taps "Import" to confirm.
7. App converts all rows to Stronger log format and appends them to the log sheet via `appendLogRows()`.
8. On success, app reloads log data and shows a confirmation message with the count of imported rows.
9. User can navigate away to progress charts or calendar history to see their imported data.

## Acceptance Criteria

- [ ] A Settings view is accessible from the nav bar (new icon/button)
- [ ] The Settings view contains a "Import from Hevy" section
- [ ] The import section includes brief instructions on how to export from Hevy
- [ ] A file picker accepts `.csv` files
- [ ] The app parses the Hevy CSV format client-side (no server needed)
- [ ] After parsing, a preview summary is shown: date range, total sets, unique exercises, workout count
- [ ] The user must confirm before any data is written
- [ ] All parsed rows are converted to Stronger's 18-column log format per the mapping table above
- [ ] Weights are converted from kg to lbs when the row's weight system is metric
- [ ] Rows with distance/seconds data and no weight are categorized as cardio
- [ ] Converted rows are appended to the log sheet via the existing `appendLogRows()` function
- [ ] After import, the in-memory log state is refreshed so progress charts and history reflect the new data
- [ ] A success message confirms how many rows were imported
- [ ] The import is idempotent-safe: the UI warns that re-importing the same file will create duplicate entries
- [ ] The view follows the existing neon visual style
- [ ] The view is usable on a phone screen

## Scope

### In scope

- New Settings view and route (`#/settings`)
- Nav bar entry for Settings
- Hevy CSV file selection and client-side parsing
- Preview summary before import
- Mapping Hevy rows → Stronger log rows
- Unit conversion (kg → lbs, meters → miles, seconds → minutes)
- Appending to sheet and refreshing in-memory state
- Duplicate-import warning

### Out of scope

- Importing workout definitions or exercise configs from Hevy — only log rows
- Matching Hevy exercises to existing Stronger exercises by name (liftId is auto-generated from the Hevy exercise name)
- Undo/rollback of an import
- Importing from any app other than Hevy
- Data export from Stronger
- Any other settings or preferences (those can be added later as the Settings view grows)
- Deduplication logic — warning only, no automatic detection of duplicate rows

## Notes

- The CSV can be parsed with a lightweight library like PapaParse, or manually via `split()` since the format is straightforward. Implementation choice.
- Hevy's timestamps may not include timezone info. Treat them as local time and convert to ISO 8601 with the browser's timezone offset.
- Some Hevy rows may have 0 weight and 0 reps (e.g., bodyweight exercises logged without details). These should still be imported — they represent completed sets.
- The `liftId` generated from Hevy exercise names won't match existing Stronger exercise configs. This is intentional: the imported data still shows up correctly in progress charts (which group by `liftId`), and the user can manually create matching exercise configs later if they want.
- Large imports (thousands of rows) should work fine since `appendLogRows()` handles batch appends. Consider showing a loading indicator during the sheet write.
- The Settings view route should be `#/settings`, added to the hash router's route union type in `src/hooks/useHashRouter.ts`.
- For the nav bar icon, a gear/cog icon (`Settings` from lucide-react) is the natural choice.

## Post-merge iterations

- The Hevy CSV import was removed from Settings, along with its parser and tests.
