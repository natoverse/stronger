# Feature: Exercise library management

> Let users view, edit, and add exercises directly in the app.

## What

This spec adds an "Exercises" tab to the app where users can browse their exercise library, edit parameters for strength exercises, and add new exercises of either type (strength or cardio) after first-time setup.

The exercises tab should feel like the existing workouts list: a scrollable list of exercises, each tappable to edit. Strength exercises expose the editable weight parameters (top set weight, backoff weight, increment, minimum weight, rounding factor, bar weight, gear type). Cardio exercises appear in the list but have no editable parameters for now — they just need a name and type.

A "new exercise" button lets the user add a strength or cardio exercise. New strength exercises should have sensible defaults for weight parameters. Changes are saved to the user's Firestore exercise or cardio-activity collection.

## Acceptance Criteria

- [ ] A new "Exercises" tab/view is accessible from the app's navigation
- [ ] All existing exercises are listed, showing name and type (strength/cardio icon)
- [ ] Tapping a strength exercise opens an editor for its parameters (top set weight, backoff weight, increment, minimum weight, rounding factor, bar weight, gear type)
- [ ] Editing a strength exercise saves changes to Firestore
- [ ] Cardio exercises are listed but have no editable parameters (name and type only)
- [ ] A "new exercise" button allows adding a strength or cardio exercise
- [ ] New exercises are written to Firestore and appear in the list immediately
- [ ] The view follows the existing neon visual style

## Scope

### In scope
- Exercise list view (browse all exercises)
- Inline or page-based editor for strength exercise parameters
- Add new exercise (strength with weight parameters, cardio with name only)
- Save changes to the user's Firestore exercise or cardio-activity collection
- Navigation to/from the exercises view

### Out of scope
- Deleting exercises (risk of orphaning workout references — defer)
- Reordering exercises
- Editing cardio exercise parameters (none defined yet)
- Exercise-specific icons or images
- Searching or filtering the exercise list

## Notes

- Strength exercises use `LiftConfig` in `src/model/types.ts` and the Firestore `exercises` collection. Cardio definitions use the simple `{ id, name }` `CardioActivity` type and the separate `cardioActivities` collection.
- The existing `WorkoutEditor` component is a good reference for the editing pattern (form fields, save/cancel flow).
- Navigation: this could be a new route (`#/exercises`) with a tab or button in the nav area, or it could share the home screen with workouts via a tab switcher.

## Post-merge iterations

- Adding an exercise to an in-progress workout initializes its work set at the exercise's configured top-set weight, rather than its bar weight.
- Exercise library cards override the workout card's bottom margin so their contents remain vertically centered without wasted space.
