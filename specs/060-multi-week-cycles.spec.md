# Feature: Multi-week training cycles

> Define explicit week-by-week sets, reps, and weights so a reusable strength plan can change structure, not just increase load.

## What

A **cycle** is a named, ordered sequence of program weeks; a **week** contains named workout slots, each describing one session's exercises and sets. A **run** is one attempt at that cycle. Program weeks are stages, not calendar weeks: elapsed time and completing a workout never advance the plan automatically.

Users author cycles by copying existing workouts and duplicating/editing weeks, preview every week's prescriptions, then start or resume a run from the workout list. Within the current week, they choose which workout to perform and explicitly advance when ready. Ordinary workouts remain independent and unchanged.

For this first version, a run retains the cycle definition and all weight-calculation inputs accepted at its start. Later template or lift-setting edits affect future runs, not the active run. Cycle sessions do not trigger ordinary post-workout weight increases; prescribed weeks alone control progression within a run.

## Acceptance Criteria

- [ ] The phone-friendly editor can create, name, save, and edit cycles; add/remove/duplicate weeks and workout slots; and edit each week's exercises and ordered sets independently. Copying a workout or week does not create a live link or modify its source.
- [ ] Each week explicitly specifies set counts, set types, fixed/ranged rep targets, AMRAP, and weight prescriptions. A three-week example of 3×8 at 70%, 4×6 at 75%, and 3×5 at 80% produces those exact structures; lighter recovery weeks are equally valid.
- [ ] Prescriptions reuse every existing `WeightBasis` option: top set, backoff, cross-reference, fixed, bar weight, and relative offset. Calculated loads retain existing rounding, warmup rounding, and minimum rules; fixed/bar-weight values retain their existing exact-value behavior.
- [ ] Save/start validation rejects unnamed cycles/workouts, fewer than two weeks, empty weeks/workouts/exercises, invalid rep ranges or weight prescriptions, and unresolved lift references, with actionable errors rather than silently dropping sets.
- [ ] Users can preview any week, including resolved weights, without starting or advancing. Starting confirms the plan and calculation inputs, begins at week 1, and allows only one active run. The active view identifies cycle, week number/total, and workout, and shows which slots have logged sessions.
- [ ] Completing, skipping, or repeating workouts leaves the current week unchanged. Repeating a workout or staying on a week records separate sessions with the same prescription. “Next week” moves exactly one stage after confirmation, warning about unperformed slots without requiring them to be completed.
- [ ] The last week offers explicit finish rather than automatic wraparound; users may also end a run early. Repeating the whole cycle starts a new run at week 1 after previewing the latest definition/current inputs, without automatic weight increases or erasing history. Finish/end/advance cannot retarget an unfinished session: finish or discard it first.
- [ ] Finishing a cycle workout still confirms and saves results but offers no weight-progression proposals and changes no shared lift weights, even after successful 100% sets or manual weight overrides. Ordinary workouts retain their existing progression; their weight updates cannot alter an active cycle run.
- [ ] Editing a cycle, its source workouts, or calculation inputs mid-run leaves the active plan, previews, and unfinished session unchanged. The UI explains that edits apply to the next run.
- [ ] User-scoped cycle definitions, run inputs/current week/status, and cycle session context survive reload and synchronization through existing Firestore/offline behavior. Resuming an unfinished session restores its original prescription and results. Data without cycle fields remains valid; existing workouts, schedules, and history are not converted.
- [ ] History retains cycle/run/week/workout identity, the performed session's planned structure and resolved targets, and actual results independently of later edits or runs. Cycle “previous session” comparisons use only the same run/week/workout and corresponding exercise/set; absent or changed matches show no value, never another week's set at the same array position.

## Scope

### In scope
- Explicit cycle authoring, preview, manual run controls, workout execution, persistence, and accurate session history.

### Out of scope
- Cycle scheduling or Google Calendar integration; existing ordinary-workout planning stays unchanged.
- Calendar-driven advancement, automatic catch-up, adaptive programming, failure-based deloads, or automatic between-cycle increases.
- Multiple simultaneous runs, editing an active run's prescriptions, cycle sharing/import formats, and bundled training programs.

## Notes

- Assumptions: one active strength cycle, frozen run inputs (including cross-referenced lifts and rounding settings), and conservative same-week comparisons keep this one bounded PR. Calendar placement and richer cross-week comparisons can follow separately.
- Aligns with the manifesto's phone-first, data-driven plans rather than protocol-specific application logic.
- Related: archived specs 001 (model), 005 (definitions), 011 (weight progression), 020 (editor), 030 (relative basis); spec 058 (offline). Grounding: `src/model/{types,compute,progression,logs}.ts`, `src/data/sample-workouts.ts`, `src/components/{WorkoutEditor,WorkoutView,CalendarView}.tsx`, `src/App.tsx`, and `src/firebase/store.ts`.
