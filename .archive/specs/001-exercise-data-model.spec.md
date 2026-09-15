# Feature: Exercise data model

> Define a structured data model for exercises, sets, and per-lift configuration so that workouts can be calculated, stored, and progressed week-to-week.

## What

We need a data model that captures all the parameters required to fully describe a workout program like RSS Intermediate B. The model must support percentage-based weight calculations, independent tracking of top-set and backoff weights, rep ranges, AMRAP sets, per-set comments (e.g., progression rules), and per-lift configuration such as weight floors and rounding.

**Firestore is the source of truth.** Every parameter in this model — top set weight, backoff weight, increment, minimum, rounding factor — is a named field in the user's exercise configuration. The app reads these values and calculates the workout from them. Defaults in application data are only for initial setup; subsequent edits use the exercise editor. For example, changing bench's increment from 2.5 lbs to 1 lb changes the next progression proposal.

**Separate persisted inputs from computed output:**

1. **Inputs** — editable lift configuration and workout templates persisted below `/users/{uid}`.
2. **Computed workouts** — concrete weights derived at runtime via percentage calculations, rounding, and minimum clamping. These computed instances are not persisted; actual execution results are saved separately as workout sessions.

The model has three layers:

1. **Lift configuration** — per-lift settings that control how weights are calculated and progressed (e.g., top set weight, backoff weight, increment, minimum weight, rounding factor).
2. **Exercise template** — the ordered list of sets for a given exercise in a workout, with each set's type, percentage basis, rep scheme, and comments.
3. **Weekly instance** — a concrete workout for a specific week with calculated weights, computed at runtime.

## Acceptance Criteria

- [ ] Each set has a **set type**: warmup, work, or backoff.
- [ ] Each set has a **percentage** of a reference weight (top set weight or backoff weight, depending on the set). The "top set" is the work set at 100% — it is not a separate type, but is identifiable as the work set with the highest percentage.
- [ ] Each set has **min reps** and **max reps**. Fixed-rep sets use the same value for both (e.g., min=5, max=5). Ranged sets differ (e.g., min=3, max=5).
- [ ] Each set has an **AMRAP flag** indicating whether the lifter should do as many reps as possible beyond the minimum.
- [ ] Each set has an optional **comment** field for progression rules or other notes visible in the app (e.g., "If 5 reps completed, increase by 2.5 lbs next week").
- [ ] Each lift has a **top set weight** and a **backoff weight**, tracked independently and updatable week-to-week.
- [ ] Each lift has an **increment** — the amount of weight to add on successful progression (e.g., 2.5 lbs for bench, 5 lbs for squat).
- [ ] Each lift has a **minimum weight** — a floor below which no set will be programmed, regardless of percentage (e.g., squat warmup cannot go below 95 lbs even if 45% calculates to 65 lbs).
- [ ] Each lift has a **rounding factor** — all calculated weights are rounded to the nearest multiple (e.g., 5 lbs for barbell, 2.5 lbs for smaller increments).
- [ ] The model supports sets where the percentage basis is derived from a *different* lift's top set weight (e.g., secondary press at 85% of primary press top set).
- [ ] Given a lift configuration and an exercise template, all set weights for a given week can be deterministically calculated.
- [ ] All lift configuration values (top set weight, backoff weight, increment, minimum, rounding factor) are stored as editable Firestore fields, not fixed in application code. The user can change any value, and the app recalculates from the updated configuration.

## Scope

### In scope
- Defining the data model (fields, types, relationships)
- Separating persisted configuration from computed workout instances
- Documenting how calculations work (percentage × reference weight → round → clamp to minimum)
- Identifying persisted fields and their mapping to the domain model

### Out of scope
- Implementing Firestore persistence
- Building the UI
- In-app editing of lift configuration inputs (future spec)
- Progression logic that automatically updates weights week-to-week (separate spec)
- Defining specific workout programs (already captured in `workouts/` folder)

## Notes

- The workout file `workouts/rss-intermediate-b.md` serves as the primary test case for validating this model. Every set in that file should be expressible with this data model.
- Secondary lifts derive their working weight from another lift's primary top set (e.g., secondary press = 85% of primary press top set; secondary squat = 75% of primary squat top set). The model needs a way to express this cross-reference.
- Assistance exercises use their own independent working weight, not derived from a primary lift. They still need top set / backoff tracking (e.g., skull crusher 100% × 8, 85% × 8+).
- All primary and secondary lifts (barbell lifts) always begin with a warmup set of the empty bar (45 lbs × 10 reps). This is a fixed warmup, not percentage-based. Assistance exercises do not have this bar warmup.

## Firestore-only iteration (2026-09-15)

- Configuration uses named document fields; computed workouts remain ephemeral. The original separation of inputs, templates, and execution results is preserved without positional storage schemas.
