# Feature: Activity types (strength and cardio)

> Add a category field to exercises so the app can distinguish strength workouts from cardio activities, enabling a broader activity list for calendar planning.

## What

Today every entry in the app is an implicitly strength-training workout with sets, reps, and weights. To support a comprehensive calendar (spec 016), the app needs to handle other kinds of activities — running, rucking, climbing, etc. — that don't go through the set/rep/weight tracking flow.

This spec introduces an activity-type distinction ("strength" vs. "cardio") alongside existing workout/exercise definitions. Strength workouts continue to work exactly as they do today. Cardio activities are simpler entries that can be assigned to calendar days but don't have computed sets or progression tracking.

The original grouping placed strength workouts first, then cardio, separated by a visual divider. Later calendar ordering decisions in spec 043 put cardio before strength; items within each group retain their application-defined order.

## Acceptance Criteria

- [ ] The model distinguishes strength exercises from cardio activities.
- [ ] Existing strength workouts default to the "strength" category with no user action required.
- [ ] Cardio activities can be persisted with an ID and name (no sets/reps/weights).
- [ ] The main workout list shows a visual distinction between strength and cardio entries.
- [ ] The calendar day picker (spec 016) groups items: strength first, then cardio, with a divider.
- [ ] Sort order within each group matches the application-defined ordering.
- [ ] Selecting a cardio activity on the calendar assigns it to that day (no workout-view navigation).

## Scope

### In scope
- Strength/cardio distinction in the domain model
- Reading and displaying cardio activities alongside strength workouts
- Grouped, ordered display in the workout list and calendar picker
- Backward compatibility — existing strength definitions remain strength entries

### Out of scope
- Tracking or logging cardio activities (duration, distance, etc.) — future spec
- Additional categories beyond strength and cardio
- Editing activity definitions from the app (covered by the exercise-library spec)

## Notes

- Firestore is the source of truth for activity definitions. Strength lift configs live in `exercises`; simple `{ id, name }` cardio definitions live in `cardioActivities` under the current user.
- The separate domain types provide the category distinction without requiring unused strength fields on cardio records.
- Tapping a cardio entry on the calendar shouldn't try to open a workout view (there are no sets). It just marks that day as having that activity. A detail/logging view for cardio can come later.
