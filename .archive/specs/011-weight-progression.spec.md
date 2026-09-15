# Feature: Post-workout weight progression

> After finishing a workout, show proposed weight updates for each lift and persist the confirmed values in Firestore.

## What

When the user taps "Finish" on a workout, instead of immediately returning to the workout list, the app navigates to a progression review page. This page evaluates every exercise in the completed workout and proposes weight changes based on the rep-range criteria already defined in the program: if the top end of the rep range was achieved (or exceeded), the lift's weight increases by its configured increment; otherwise the weight stays the same.

Each proposed change is shown as a line item the user can review and override (e.g. accept the suggested increase, keep the current weight, or type a custom value). Once the user confirms, the app writes the updated `topSetWeight` and/or `backoffWeight` fields to the lift's Firestore exercise document. The next time a workout is loaded, it picks up the new weights automatically.

This covers any exercise whose sets use direct weight basis (`topSet` or `backoff`). Exercises whose work/backoff sets all use `crossReference` weight basis are excluded from progression — their weights are derived from another lift's config and update automatically when that source lift is progressed.

## Acceptance Criteria

- [ ] Tapping "Finish" navigates to a progression review page (not directly back to the workout list).
- [ ] For each eligible exercise, the page reads the lift's `increment` from its configuration and the rep-range upper bound from the set template.
- [ ] Exercises whose work/backoff sets all use `crossReference` weight basis are excluded from the progression page — their weights are derived from another lift's config.
- [ ] If the recorded reps on the relevant set meet or exceed the upper bound, the proposed new weight = current weight + increment.
- [ ] If the recorded reps are below the upper bound, the proposed new weight = current weight (no change).
- [ ] Each proposed weight is editable — the user can accept, reject, or override with a custom value.
- [ ] A "Confirm" button writes the final `topSetWeight` / `backoffWeight` fields to the lift's Firestore exercise document.
- [ ] After confirmation, the app navigates to the workout list (or the existing "Workout Complete" summary).
- [ ] Exercises that share the same underlying `liftId` are grouped so the user sees one progression decision per lift, not per exercise row.
- [ ] Exercises using only `crossReference` weight basis are not shown on the progression page.

## Scope

### In scope
- Progression review page UI (list of lifts with current → proposed weight)
- Evaluation logic: compare actual reps to rep-range upper bound
- Editable proposed weights
- Writing updated config values to Firestore
- Navigation flow: Finish → Review → Confirm → Workout list

### Out of scope
- Deload / reset logic (weight decreases on repeated failures)
- History of progression decisions
- Undo / rollback after confirmation
- Changing the increment value from this page

## Notes

- The progression check should look at the **work** and **backoff** set types specifically (not warmup sets).
- For work sets, compare against `topSetWeight`; for backoff sets, compare against `backoffWeight`.
- Exercises whose work/backoff sets all use `crossReference` weight basis are excluded. This means a "secondary" exercise that uses `topSet` or `backoff` weight basis (i.e. has its own independent weights) will be included in progression. Only the cross-reference mechanism triggers exclusion, not the exercise role.
- If a lift appears multiple times across exercises (e.g. the same `liftId` as both primary and assistance), surface it once with the most relevant progression signal.
- The `increment` field already exists on `LiftConfig` and is read from persisted configuration — no schema changes needed.
