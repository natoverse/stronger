# Feature: Data-driven workout definitions

> Store workout definitions (exercise order, set structure, rep ranges) as user-owned data rather than hard-coded TypeScript.

## What

The original feature moved workout structure — which exercises belong to each workout and the set templates for each exercise — out of application code. Lift configuration and workout definitions now both come from Firestore.

Each document in `/users/{uid}/workouts` stores one workout definition with ordered exercise and set arrays. Array order preserves exercise grouping and set order.

Domain fields:

| Field | Meaning |
|-------|---------|
| Workout `id`, `name`, `favorite` | Stable identity, display name, and favorite state |
| Ordered `exercises` | Exercise templates grouped by workout |
| Exercise `role`, `liftId` | primary / secondary / assistance; configured lift reference |
| Ordered `sets` | Set templates grouped by exercise |
| Set type and `percentage` | Set classification and reference-weight multiplier |
| Set `weightBasis` | Discriminated union, including topSet, backoff, crossReference, fixed, barWeight, and relative |
| Set `minReps`, `maxReps`, `amrap`, `comment` | Rep targets, AMRAP flag, and optional notes |

On first setup, starter definitions are available for explicit import. On subsequent visits, persisted `WorkoutDefinition[]` values replace defaults at runtime. Exercise display names are derived from role and lift configuration rather than duplicated in storage. `weightBasis` is stored as a named-field object.

`buildWorkoutsFromConfigs` accepts workout definitions as a parameter instead of referencing a module-level constant. Default workout data is retained solely as the starter template source.

## Acceptance Criteria

- [ ] Each stored workout preserves all exercises and sets in order.
- [ ] Explicitly imported starter definitions reproduce the original four workouts with three exercises each and all existing sets.
- [ ] On subsequent visits, the app reads Firestore workout documents as `WorkoutDefinition[]` with embedded `ExerciseTemplate[]`.
- [ ] Parsed workout definitions produce identical computed workouts as the current hard-coded path (given the same lift configs).
- [ ] Saved editor changes to sets, percentages, or exercise order are reflected on the next load.
- [ ] `buildWorkoutsFromConfigs` accepts workout definitions as a parameter; it no longer references the hard-coded module-level `workoutDefinitions` constant.
- [ ] `weightBasis` correctly round-trips every supported discriminated-union variant.
- [ ] Exercise display names are derived from role and lift name (e.g., "Primary: Bench Press").
- [ ] Saving a definition does not modify exercise configuration or workout history.
- [ ] Setup and explicit starter imports initialize user data without overwriting existing definitions.

## Scope

### In scope
- Defining the persisted workout document structure
- Explicitly importing default workout definitions during setup
- Reading workout documents into `WorkoutDefinition[]` on subsequent visits
- Updating `buildWorkoutsFromConfigs` to accept workout definitions as a parameter
- Preserving the `weightBasis` discriminated union in stored objects
- Deriving exercise display names from `exerciseRole` + lift config name

### Out of scope
- In-app UI for editing workout definitions (covered by the workout-editor spec)
- Adding or removing workouts beyond the current four (the schema supports it, but validation/UI for arbitrary workout counts is deferred)
- Versioning or migration logic for workout definitions
- Offline caching of workout definitions
- Changes to exercise configuration or workout history

## Notes

- `WorkoutDefinition`, `ExerciseTemplate`, and `SetTemplate` remain domain types independent of persistence.
- Nested arrays preserve exercise and set order; names and favorite state are stored once per workout.
- Weight-basis variants must round-trip even when not used by starter workouts.

## Iteration log

- Startup no longer auto-seeds default workout definitions when no readable definitions exist. Instead, the app shows an explicit user prompt to import default workouts, so missing/failed loads do not trigger automatic overwrites.
- The Firebase default workout import path assigns fresh generated IDs to starter workouts and adds them without deleting or replacing existing workout documents. The generated target IDs are checked transactionally before writing.
- Duplicating a workout template now creates an unsaved editor draft; canceling leaves stored workout definitions unchanged, and persistence happens only from the editor Save action.
- **Firestore-only (2026-09-15):** Named fields and ordered arrays replace positional serialization. Starter imports, fresh IDs, non-destructive saves, and unsaved duplication drafts retain their established behavior.
