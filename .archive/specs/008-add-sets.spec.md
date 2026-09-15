# Feature: Add sets during a workout

> Let the lifter add extra sets to any exercise mid-workout by tapping a + button, pre-filled from the previous set's parameters.

## What

Each exercise in the workout view gets a "+" button at the bottom of its set list. Tapping it appends a new set row to that exercise, pre-filled with the same set type, weight, and rep range as the last set in the list. The lifter can then edit the new set's values as needed before completing it.

This covers the common case of wanting an extra backoff set, an additional joker set, or just more volume on a good day. The added sets are saved to the workout log alongside the planned sets when the workout is finished.

## Acceptance Criteria

- [ ] Each exercise displays a "+" button below its last set.
- [ ] Tapping "+" appends a new set row to that exercise.
- [ ] The new set is pre-filled with the set type, weight, and rep range of the previous set in that exercise.
- [ ] The new set's weight, reps, and type are editable like any other set.
- [ ] Added sets are included in the workout log when saved to Firestore.
- [ ] The "+" button is thumb-friendly on mobile.

## Scope

### In scope
- "+" button per exercise in the workout execution UI
- Cloning parameters from the previous set
- Saving added sets to the workout log

### Out of scope
- Removing or reordering sets
- Adding entire new exercises to a workout
- Any impact on workout templates or computed workouts (added sets are session-only)

## Notes

- Added sets are ephemeral — they exist only in the current session and get recorded in the log. They do not modify the workout template or exercise configuration.
- If the previous set is an AMRAP backoff, the new set should also inherit the AMRAP flag.
