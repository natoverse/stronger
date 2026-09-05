# Feature: Workout editor

> Add an in-app editor for creating new workout definitions and modifying existing ones, using a spreadsheet-style form that writes back to the Google Sheet.

## What

Today workout definitions can only be changed by editing the Google Sheet directly. This spec adds a phone-friendly editor screen that lets you create a new workout or modify an existing one — add exercises, assign roles, and define sets with percentage, rep range, and AMRAP — then save everything back to the Workout Defs tab.

The editor uses a spreadsheet-inspired model. Each set row shows weight as a percentage of the weight basis (top set by default), a min reps and max reps field, and an AMRAP checkbox. Exercises are listed vertically; within each exercise, sets are listed as compact rows that can be added or removed. The editor is reached from the workout list (edit an existing workout or create a new one) and lives at its own route.

Saving persists the full workout definition to the sheet using the existing `workoutDefsToRows()` serialization, replacing all rows for that workout ID. The sheet remains the source of truth.

## Acceptance Criteria

- [ ] A new route (`#/edit/{workoutId}` for existing, `#/edit/new` for new) opens the editor.
- [ ] The workout list provides entry points: an edit action on each workout and a "new workout" action.
- [ ] The editor displays the workout name (editable text field) and category (strength / cardio).
- [ ] Exercises are listed in order; each exercise shows its lift (selectable from available lifts) and role (primary / secondary / assistance).
- [ ] Within each exercise, sets are displayed as compact rows with: set type (warmup / work / backoff / joker), percentage, weight basis (top set / backoff / cross-reference / fixed), min reps, max reps, and an AMRAP checkbox.
- [ ] The user can add a new exercise to the workout and add or remove sets within an exercise.
- [ ] The user can remove an exercise from the workout.
- [ ] Saving writes the workout definition to the Workout Defs sheet tab, replacing all prior rows for that workout ID.
- [ ] Validation prevents saving when: workout has no name, an exercise has no lift selected, or an exercise has zero sets.
- [ ] After a successful save, the app navigates back to the workout list.

## Scope

### In scope
- Editor screen with route for new and existing workouts
- Exercise management (add, remove)
- Set management within an exercise (add, remove)
- All SetTemplate fields: setType, percentage, weightBasis, minReps, maxReps, amrap
- Persisting to the Google Sheet via existing serialization functions
- Entry points from the workout list
- Basic validation before save

### Out of scope
- Deleting an entire workout definition from the sheet (can be a follow-up)
- Undo / redo within the editor
- Drag-and-drop reordering of exercises or sets
- Inline preview of computed weights (the editor works with percentages, not resolved numbers)
- Editing lift configurations (top set weight, increments, etc.)
- Duplicate / clone workout

## Notes

- The editor writes `WorkoutDefinition` rows to the sheet. It should use `workoutDefsToRows()` for serialization and the existing sheet-write path. For an existing workout, all rows matching that workout ID are replaced; for a new workout, rows are appended.
- Weight basis defaults to "top set" for most use cases. The cross-reference and fixed options are less common but should be available — a dropdown or segmented control per set row is sufficient.
- Workout ID for new workouts can be auto-generated from the name (kebab-case slug) or entered manually. Either approach is fine as long as it's unique.
- Keep the form thumb-friendly — inputs should be large enough to tap accurately on a phone. Consider collapsible exercise sections if the workout gets long.
- The set type and weight basis fields use the existing enums (`SetType`, `WeightBasis`) from the data model. The serialization format for weight basis in the sheet is already defined: `topSet`, `backoff`, `crossReference:<liftId>`, `fixed:<number>`.

## Iteration decisions

### Set reordering (2026-09-05)

- Each set row has up and down controls that move the set one position within its exercise.
- The first set's up control and the last set's down control are disabled.
- Reordering preserves all set fields and is saved through the existing workout definition flow.
- Drag-and-drop reordering remains out of scope.
