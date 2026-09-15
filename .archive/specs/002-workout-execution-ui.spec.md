# Feature: Workout execution UI

> A phone-first interface for selecting a workout, working through each set with checkboxes, and saving results to Firestore.

## What

When the user opens the app, they see a list of available workouts (A–D). Selecting one loads the full workout — primary, secondary, and assistance exercises — with every set displayed as a row showing the planned weight, rep target, set type, and any comments (e.g., progression rules).

Each set has a checkbox to mark it complete, plus editable fields for the weight actually used and reps actually performed (pre-filled with the planned values). This allows on-the-fly adjustments — if a planned set says 185 lbs × 5 but the lifter only manages 3, they update the reps before checking it off. Comments like "If 5 reps completed, increase by 2.5 lbs next week" are visible inline so the lifter knows the stakes of each set.

The UI is modeled after apps like Heavy — a vertical list of exercises, each with its sets listed beneath, optimized for one-handed phone use in a gym. Large tap targets, readable text at arm's length.

When all sets are done (or the user decides they're finished), they tap "Finish Workout." This saves the actual weights and reps for every set as a new Firestore workout session. Completed sessions form the training history without overwriting earlier sessions.

## Acceptance Criteria

- [ ] User can select a workout (A, B, C, or D) from a list on the home screen.
- [ ] Selected workout displays all exercises (primary, secondary, assistance) with their sets in order.
- [ ] Each set row shows: planned weight, planned reps (or rep range), set type (warmup/work/backoff), AMRAP indicator if applicable, and comment text.
- [ ] Each set has a checkbox to mark it complete.
- [ ] Weight and reps fields on each set are editable so the user can record what actually happened.
- [ ] Fields are pre-filled with planned values computed from persisted configuration and templates.
- [ ] A "Finish Workout" button saves all actual weights and reps to Firestore.
- [ ] Completed workout data is saved as a permanent session record, not overwriting previous sessions.
- [ ] The UI is usable on a phone in portrait orientation — large tap targets, readable at arm's length.

## Scope

### In scope
- Workout selection screen
- Exercise/set display with checkboxes and editable fields
- Inline comment display per set
- Saving results to Firestore on finish
- Adding workout-session records to training history

### Out of scope
- Firebase Authentication and Firestore connection (separate spec)
- Rest timers between sets
- Automatic progression logic (updating input weights for next week)
- In-app editing of lift configuration inputs (top set weight, increment, etc.)
- Workout history / review of past sessions

## Notes

- This spec assumes the data model from spec 001 is in place and workouts are computed from the user's stored configuration and templates.
- The "Finish Workout" write saves session results separately from exercise configuration and workout templates.
- Consider what happens if the user closes the app mid-workout. Saving only on "Finish" means progress could be lost. This is acceptable for v1 — we can add auto-save in a future spec if needed.

## Post-merge iterations

- **Finish button relocated**: The "Finish Workout" button was moved from a fixed bottom bar to a compact button in the sticky header (top right). This freed up the entire viewport for scrolling through sets, which matters on a phone. The button label was shortened from "Finish Workout" to "Finish".
- **Color scheme de-blued**: The finish button background was changed from the blue accent color to dark grey (`#333`) with light text. The back button was similarly changed from blue to muted grey (`var(--color-text-muted)`). This removed the last blue interactive elements from the workout view for a more cohesive dark theme.
- **Set comments moved below inline badges**: Rep range and AMRAP info were moved from inline badges to a comment line below the set row for a cleaner layout.
- **Firestore-only persistence (2026-09-15)**: Session writes use stable Firestore document identities and the offline queue from spec 058. Shared `ParsedLogRow` values remain a domain representation of logged sets, not a positional storage format.
