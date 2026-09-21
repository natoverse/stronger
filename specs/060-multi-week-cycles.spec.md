# Feature: Multi-week training cycles

> Define and schedule reusable week-by-week strength plans with shared training-max inputs, frozen run prescriptions, and an explicit end-cycle progression review.

## What

A **cycle** is a named, ordered sequence of one or more program weeks; each **week** is a stage containing named workout slots. A **run** is one attempt at a cycle. Users author cycles by copying workouts and duplicating/editing weeks, preview prescriptions, and schedule a whole run's slots on dates. Calendar and Today's Plan launches resolve the assigned run/stage/slot, not whichever week happens to be current.

**Training max (TM)** is an optional shared exercise setting, editable alongside other `LiftConfig` fields and available as a `trainingMax` weight basis in any workout. It is distinct from top-set/backoff weights and estimated max; only prescriptions using TM require it. Cycles do not own TM defaults. Starting a run confirms and freezes its definition and shared calculation/progression inputs; explicit run-only overrides never silently overwrite shared settings.

Progression policies and triggers are data, not separate ordinary/cycle execution paths. Prescribed multi-week progression holds inputs constant within a run and offers a TM review at its completed boundary. Shared cycle/week/slot and execution/progression infrastructure, representing ordinary workouts as one-week cycles, is the **proposed approach**, subject to the representation decision below. Existing ordinary post-workout top/backoff progression and frictionless ad hoc use must remain intact.

### Required example: classic four-week 5/3/1

Jim Wendler's classic 5/3/1 is the primary acceptance case. Each main lift has its own **training max (TM)**, distinct from its actual/estimated one-rep max and from the app's existing top-set/backoff weights. The classic starting TM is 90% of one-rep max; users enter and confirm the TM directly rather than the app inferring it from a previous session or treating `topSetWeight` as a max.

All percentages below are of that lift's TM, held constant for the entire run:

| Program week | Work set 1 | Work set 2 | Work set 3 |
|---|---|---|---|
| 1 — 5s | 65% × 5 | 75% × 5 | 85% × 5+ |
| 2 — 3s | 70% × 3 | 80% × 3 | 90% × 3+ |
| 3 — 5/3/1 | 75% × 5 | 85% × 3 | 95% × 1+ |
| 4 — Deload | 40% × 5 | 50% × 5 | 60% × 5 |

The base rep targets are 5/5/5, 3/3/3, 5/3/1, and 5/5/5. A `+` uses the existing AMRAP flag with that minimum rep target, not an upper cap; the deload has no AMRAP sets. Users may turn AMRAP off for fixed-rep variants. These are ordinary editable week/set prescriptions, not a hard-coded 5/3/1 mode. Warmups and assistance work remain independently editable.

For a 200 lb TM, 5 lb work-set rounding, and a 45 lb minimum, the resolved work sets are 130/150/170 lb, 140/160/180 lb, 150/170/190 lb, and 80/100/120 lb respectively. Percentages always apply to TM, never to the preceding set or week's working weight. A floor that raises a deload weight still follows existing calculation rules and is visible in the preview.

At the completed run boundary, a prescribed multi-week trigger suggests a TM increment for explicit accept/keep/custom-value review. Accepted TM changes affect future TM-based calculations, not top/backoff fields or frozen runs. There are no automatic TM changes or assumed performance thresholds; later 5/3/1 variants are not required.

## Acceptance Criteria

- [ ] The phone-friendly editor can create, name, save, and edit cycles; add/remove/duplicate weeks and workout slots; and edit each week's exercises and ordered sets independently. Copying a workout or week does not create a live link or modify its source.
- [ ] Each week explicitly specifies set counts, set types, fixed/ranged rep targets, AMRAP, and weight prescriptions. A three-week example of 3×8 at 70%, 4×6 at 75%, and 3×5 at 80% produces those exact structures; lighter recovery weeks are equally valid.
- [ ] Prescriptions reuse every existing `WeightBasis` option (top set, backoff, cross-reference, fixed, bar weight, relative offset) and add `trainingMax` everywhere bases are supported, including ordinary workouts. Calculated loads retain existing rounding, warmup rounding, and minimum rules; fixed/bar-weight values remain exact.
- [ ] TM is optional on shared exercise `LiftConfig` and editable in normal exercise configuration, with no cycle-owned defaults. A missing, non-finite, or non-positive TM blocks preview/start only where required by a prescription, with an actionable error and no top-set fallback. Run start confirms/snapshots shared inputs and any explicit run-only overrides without writing them back.
- [ ] The editor can express the complete four-week 5/3/1 table above, including independent percentages on all three sets, last-set AMRAP in weeks 1–3, and a non-AMRAP deload. Preview and execution show the week, rep target/AMRAP, percentage, clearly labeled TM basis, and resolved weight.
- [ ] Save/start validation accepts one or more weeks and rejects unnamed cycles/workouts, zero weeks, empty weeks/workouts/exercises, invalid rep ranges or weight prescriptions, and unresolved lift references with actionable errors, never silently dropping sets.
- [ ] Users preview any week without starting/advancing, and start/resume from the workout list. A new multi-week run begins at week 1; views identify cycle, run, stage number/total, slot, and logged sessions. At most one active multi-week run is allowed; ordinary one-week/ad hoc workouts remain available without repetitive run setup/end screens.
- [ ] Users plan an entire run's workout slots on the internal calendar. Every occurrence retains stable cycle/run/stage/slot identity and its own occurrence identity, even when source workouts repeat. Calendar and Today's Plan launch the correct frozen prescription; completion matches that occurrence, never date/workout ID alone.
- [ ] Moving dates or repeating a slot never silently relabels its prescription; repeats create separate occurrences/sessions. Planning preserves unrelated dates/events and existing cardio/rest/blocker semantics. Existing Google Calendar sync retains cycle context and distinct occurrences across synchronization.
- [ ] Stage controls support explicit navigation/advancement with warnings for unperformed slots; elapsed calendar time alone does not advance prescriptions. Missed-slot handling and completion follow the decisions below once confirmed. Finish/end/advance cannot retarget an unfinished session: finish or discard it first. Early ending is distinct from completion; repeating the cycle starts a new run with the latest confirmed definition/inputs and preserves history.
- [ ] Finishing a workout saves results and applies its prescribed progression trigger. Under a multi-week TM policy, individual sessions do not propose ordinary top/backoff bumps, including after successful 100% sets or manual load overrides. Ordinary eligible workouts retain existing per-session top/backoff proposals, never a new calendar-week delay.
- [ ] At a completed run boundary, each lift with a prescribed TM increment receives one review per lift/run boundary: accept the suggested value, keep TM, or confirm a custom valid value. Only explicit acceptance/custom confirmation updates shared TM; no automatic change or unapproved performance gate is introduced. Persisted review outcomes prevent duplicate application after reload, retry, or synchronization; completed snapshots/history remain immutable.
- [ ] Mid-run edits to templates, shared inputs (including cross-references/rounding), or ordinary progression leave frozen run previews, execution, and unfinished sessions unchanged. The UI explains that changed inputs apply to future runs; run-only overrides never silently replace shared settings.
- [ ] User-scoped definitions, frozen inputs, run stage/status, planned identities, session context, and TM review state survive reload and existing Firestore/offline synchronization. Unfinished sessions restore original prescriptions/results; Google Calendar operations retain their existing online-only behavior.
- [ ] Existing workouts, schedules, and logs without cycle fields remain usable without destructive migration. History retains cycle/run/stage/slot/occurrence identity, planned structure/resolved targets, and actual results independently of edits. Multi-week previous-session comparisons require the same run/stage/slot and corresponding exercise/set; absent or changed matches show no value rather than another stage's set at the same index. Ordinary workouts retain existing comparisons across sessions.
- [ ] Automated tests cover all 12 example weights/prescriptions, distinct lift TMs, optional/invalid TM, AMRAP/deload, rounding/minimums, variable sets, confirmed lifecycle policies/repeats, calendar identity/moves/reused workouts, Google sync preservation, frozen history/offline restoration, idempotent TM review, and unchanged ordinary progression/compatibility.

## Scope

### In scope
- Cycle authoring/validation, shared TM basis, frozen runs, internal whole-run scheduling and existing Google sync compatibility, execution/history/offline persistence, and prescribed end-cycle TM review.
- Data-driven progression triggers and shared execution; proposed ordinary one-week representation subject to confirmation below.

### Out of scope
- Broader external-calendar auto-advancement, adaptive programming, failure-based deloads, or automatic TM changes. Missed-slot rescheduling is unresolved, not silently excluded.
- Multiple simultaneous multi-week runs, editing frozen prescriptions, cycle sharing/import formats, and bundled programs.

## Open decisions — provisional recommendations

Resolve these lifecycle choices before implementation; recommendations are **not accepted decisions**.

1. **Missed workouts:** keep each entry's assigned stage with explicit move/skip, or automatically shift subsequent dates? **Recommend:** retain assignments and require explicit move/skip; never silently relabel stages.
2. **Completion:** explicit finish of the final stage with missed-slot warnings, or automatic completion when all scheduled slots are done? **Recommend:** explicit finish; early ending does not count as completion or trigger the completion TM review.
3. **TM increment:** reuse the existing per-lift increment or configure a separate TM increment? **Recommend:** reuse it as the initial default unless a separate amount is wanted.
4. **Ordinary one-week cycles:** each workout as a transparently repeating one-week cycle, or a multi-workout weekly plan whose progression waits for the whole week? **Recommend:** per-workout representation retaining per-session bumps. A week-delayed alternative would require explicitly revising the compatibility criteria above.

## Iteration decisions — 2026-09-21

- User feedback supersedes cycle-owned TM defaults: TM belongs to shared exercises and any weight prescription; runs freeze inputs without implicit writeback.
- Internal scheduling and boundary TM suggestions are now in scope, replacing their original exclusions. Stable occurrence identity prevents reused workouts, moves, or sync from selecting the wrong stage; suggestions require explicit review, not automatic increases.
- One-week cycles are valid and a common execution model is proposed to avoid ordinary/cycle branching. This replaces the two-week minimum and strict model separation, not existing behavior guarantees; lifecycle and ordinary representation choices remain open above.

## Notes

- Aligns with the manifesto's phone-first, data-driven plans rather than protocol-specific application logic.
- Existing “weekly” top/backoff bumps actually trigger when eligible workouts finish, not on a calendar-week timer (`src/model/progression.ts:46–179`; archived spec 011). Unification must not silently change that cadence or let the active multi-week run block ordinary sessions.
- The 5/3/1 table describes the classic four-week main-lift template, not every program bearing that name; supporting this acceptance fixture does not require shipping a bundled program. Reference: [5/3/1 program overview](https://barbend.com/5-3-1-program/).
- Related: archived specs 001 (model), 005 (definitions), 011 (weight progression), 020 (editor), 030 (relative basis); spec 058 (offline). Grounding: `src/model/{types,compute,progression,logs}.ts`, `src/data/sample-workouts.ts`, `src/components/{WorkoutEditor,WorkoutView,CalendarView}.tsx`, `src/App.tsx`, and `src/firebase/store.ts`.
