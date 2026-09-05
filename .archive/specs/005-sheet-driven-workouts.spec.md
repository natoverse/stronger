# Feature: Sheet-driven workout definitions

> Move workout definitions (exercise order, set structure, rep ranges) from hard-coded TypeScript into a "Workout Defs" tab in the Google Sheet, making the app entirely data-driven.

## What

The app's lift configurations (weights, increments) are already read from the Google Sheet, but the workout structure — which exercises belong to which workout, and the set templates for each exercise — is still hard-coded in `src/data/sample-workouts.ts`. This spec moves that last piece of hard-coded data into the spreadsheet.

A new tab called **"Workout Defs"** is added to the workbook. It uses a flat row-per-set layout: each row defines one set within one exercise within one workout. Rows are grouped by `workoutId` + `exerciseOrder`, and sets within a group appear in row order. A header row is always present.

Column layout:

| Col | Field | Example values |
|-----|-------|----------------|
| A | workoutId | A, B, C, D |
| B | workoutName | Workout A — Bench / Squat |
| C | exerciseOrder | 1, 2, 3 |
| D | exerciseRole | primary, secondary, assistance |
| E | liftId | bench, squat, press, deadlift, skull-crusher, barbell-row |
| F | setType | warmup, work, backoff |
| G | percentage | 0.5, 0.6, 0.7, 0.8, 0.85, 1.0 |
| H | weightBasis | topSet, backoff, crossReference:press, fixed:45 |
| I | minReps | 1, 3, 5, 8, 10 |
| J | maxReps | 1, 3, 5, 8, 12, 15 |
| K | amrap | TRUE, FALSE |
| L | comment | *(optional)* "If 5 reps completed, increase by 2.5 lbs next week" |

On first connect (tab doesn't exist or is empty), the app creates the tab and writes the current hard-coded workout definitions as default rows. On subsequent visits, it reads the tab and parses the rows into `WorkoutDefinition[]`, fully replacing the hard-coded data at runtime. The exercise display name is derived from `exerciseRole` + the lift's name (looked up from configs), so no separate name column is needed. The `weightBasis` column encodes the discriminated union as a single string: `topSet`, `backoff`, `crossReference:<liftId>`, or `fixed:<number>`.

`buildWorkoutsFromConfigs` is updated to accept workout definitions as a parameter instead of referencing the module-level constant. The hard-coded data in `sample-workouts.ts` is retained solely as the default seed for first-connect writes.

## Acceptance Criteria

- [ ] A "Workout Defs" tab is created in the workbook on first connect, with a header row and one row per set matching the column layout above.
- [ ] Default rows written on first connect reproduce the exact same workouts as the current hard-coded definitions (4 workouts × 3 exercises each, with all existing sets).
- [ ] On subsequent visits, the app reads the "Workout Defs" tab and parses rows into `WorkoutDefinition[]` with embedded `ExerciseTemplate[]`.
- [ ] Parsed workout definitions produce identical computed workouts as the current hard-coded path (given the same lift configs).
- [ ] If the user edits the "Workout Defs" tab in the sheet (e.g., adds a set, changes a percentage, reorders exercises), the app reflects the change on next load.
- [ ] `buildWorkoutsFromConfigs` accepts workout definitions as a parameter; it no longer references the hard-coded module-level `workoutDefinitions` constant.
- [ ] The `weightBasis` column correctly round-trips all four variants: `topSet`, `backoff`, `crossReference:<liftId>`, `fixed:<number>`.
- [ ] Exercise display names are derived from `exerciseRole` + lift name at parse time (e.g., "Primary: Bench Press"), not stored as a separate column.
- [ ] The existing "Stronger" tab (config zone, log zone, blank separator) is unchanged.
- [ ] The connect flow writes both default configs and default workout defs when the sheet is empty, and reads both on subsequent visits.

## Scope

### In scope
- Defining the "Workout Defs" tab layout (columns, header, row-per-set structure)
- Writing default workout definitions on first connect
- Reading and parsing the tab into `WorkoutDefinition[]` on subsequent visits
- Updating `buildWorkoutsFromConfigs` to accept workout definitions as a parameter
- Serializing/deserializing the `weightBasis` discriminated union to/from a single string column
- Deriving exercise display names from `exerciseRole` + lift config name

### Out of scope
- In-app UI for editing workout definitions (user edits the sheet directly)
- Adding or removing workouts beyond the current four (the schema supports it, but validation/UI for arbitrary workout counts is deferred)
- Versioning or migration logic for the tab layout
- Offline caching of workout definitions
- Changes to the "Stronger" tab layout or log zone behavior

## Notes

- The `WorkoutDefinition` interface and `ExerciseTemplate` / `SetTemplate` types do not need to change — the sheet is a different serialization of the same data model.
- The `exerciseOrder` column (1, 2, 3) controls grouping and ordering. Rows with the same `workoutId` + `exerciseOrder` form one exercise; sets appear in row order within that group. This is simpler than blank-row separators and survives sheet sorting.
- The `workoutName` column is intentionally denormalized (repeated on every row for the same workout). This makes the sheet human-readable without requiring a separate lookup tab.
- `crossReference:<liftId>` and `fixed:<number>` weight basis variants exist in the type system but aren't used by the current four workouts. They should still round-trip correctly through serialization for future use.
- Creating a new tab requires the `spreadsheets.batchUpdate` API (addSheet request), which is already used by the app. Reading/writing cell values uses the Values API, same as the config zone.

## Iteration log

- Startup no longer auto-seeds default workout definitions when the workout tab has no readable definitions. Instead, the app shows an explicit user prompt to import default workouts, so missing/failed loads do not trigger automatic overwrites.
- The Firebase default workout import path is additionally guarded at the write layer: starter workouts are only written when the workout collection is empty, and existing workout documents block the import instead of being replaced.
- Duplicating a workout template now creates an unsaved editor draft; canceling leaves stored workout definitions unchanged, and persistence happens only from the editor Save action.
