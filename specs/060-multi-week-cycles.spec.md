# Feature: Multi-week training cycles

> Open a familiar workout card and perform the next prescribed session: exercises advance independently through repeatable cycles, with automatic completion and stage-aware baseline review.

## What

A **cycle** replaces the conceptual workout on the home page, keeping its existing name, identity, and familiar card. Ordinary workouts are individual, repeating one-week cycles. A cycle has one or more ordered program **weeks**, each containing ordered session prescriptions (**exposures**). Weeks describe programming, not elapsed calendar time. Each exercise tracks its own position and iteration through those prescriptions; there is no global current week or single-active-cycle restriction.

Opening a cycle from its card, Today's Plan, or the calendar resolves each exercise's **next uncompleted exposure**. Missing a date does nothing to progress: the same prescription is offered next time, whether later that week or the following week. Exercises completed in a partially performed workout advance independently of exercises left unfinished. Confirming results automatically advances eligible exercises and rolls completed iterations back to week 1; there is no separate start-run, next-week, or finish-cycle action.

**Training max (TM)** and its separate **TM increment** are optional shared exercise settings, editable alongside other `LiftConfig` fields. TM is available as a `trainingMax` weight basis in any set, distinct from top-set/backoff weights and estimated max. Cycles do not own duplicate TM defaults. A cycle's progression baseline is either **top set** or **TM**; this determines which baseline and increment its completion policy reviews, not a replacement for each set's independently editable weight basis.

Use the same cycle resolution, execution, and confirmation flow for one-week and multi-week plans. Each exercise iteration freezes its prescriptions and calculation inputs, including cross-references and rounding settings. An unfinished session also freezes its resolved targets. Shared edits and accepted increments affect future iterations, never an exercise still working through its existing iteration.

### Automatic progression rules

- Each exercise visits its prescribed exposures in week order and then within-week order. Exercises absent from an exposure have nothing to perform there. The next session presents each exercise's next prescription, so exercises can legitimately be on different weeks or within-week exposures.
- Marking all programmed non-warmup sets complete completes an exercise's exposure; a warmup-only exercise requires all its sets. Reps below target are still a performed exposure, not an implicit repeat or deload. Skipping or partially completing the required sets retains the whole pending prescription, while saving actual results. Calendar time, opening a card, individual set completion, and unconfirmed results never advance progress.
- Completing an exposure advances once, to the next exposure in the same week if present, otherwise the next prescribed week. Completing the last exposure of the last week ends that exercise's iteration automatically. The normal finish confirmation shows the completed stage, next stage, retained prescriptions, and any baseline proposal; confirming it saves results, progression, and accepted baseline changes together.
- **TM baseline:** hold TM constant for every set and exposure of an exercise's iteration, including recovery/deload weeks. Only final-exposure completion proposes `TM + TM increment`, once per exercise iteration. This is a prescribed completion trigger, not a rep-performance test. Do not derive TM from actual working weight, AMRAP reps, a previous set, or the preceding week's weight; do not also propose top-set/backoff changes.
- **Top-set baseline:** preserve the existing performance-based top-set/backoff proposal rules and normal increment. Ordinary one-week workouts retain their current post-workout proposals, including actual-weight overrides; they do not acquire a calendar-week delay. For multi-exposure iterations, retain eligible performance signals until the boundary so a final recovery exposure does not erase an earlier qualifying work set.
- Baseline changes remain suggestions in the existing confirmation flow: accept, keep, or enter a valid custom value. Automatic stage progression does not mean an unreviewed weight increase. The next iteration uses the then-current shared settings after confirmation; accepting one exercise's increase cannot alter another exercise's frozen iteration.
- Session and exercise-iteration identities make confirmation/reload/retry idempotent. Returning to an unfinished session restores its original targets and results rather than resolving a newer stage. Different cycles progress independently; an unfinished session must not silently be replaced.

### Calendar and card behavior

Plan cycle workout opportunities on dates using the existing calendar planner, including a complete multi-week schedule. Calendar entries reference the named cycle and retain occurrence identity, but forecast weeks are **not** authoritative prescriptions: opening an appointment always resolves next pending work from actual exercise progress. Moving a date, missing appointments, or synchronizing Google Calendar must not skip stages or create extra catch-up work.

A single-week cycle's home card looks like the existing workout card. A multi-week card shows its week number/total; when exercises diverge, show their individual stages rather than a misleading single current week. Execution and finish confirmation likewise identify per-exercise week and within-week exposure. Completing one appointment must not mark another occurrence completed merely because the cycle name or workout ID matches.

### Required example: classic four-week 5/3/1

Jim Wendler's classic 5/3/1 is the primary acceptance case. Each main lift has its own **training max (TM)**, distinct from its actual/estimated one-rep max and from the app's existing top-set/backoff weights. The classic starting TM is 90% of one-rep max; users enter and confirm the TM directly rather than the app inferring it from a previous session or treating `topSetWeight` as a max.

All percentages below are of that lift's TM, held constant for its entire iteration:

| Program week | Work set 1 | Work set 2 | Work set 3 |
|---|---|---|---|
| 1 — 5s | 65% × 5 | 75% × 5 | 85% × 5+ |
| 2 — 3s | 70% × 3 | 80% × 3 | 90% × 3+ |
| 3 — 5/3/1 | 75% × 5 | 85% × 3 | 95% × 1+ |
| 4 — Deload | 40% × 5 | 50% × 5 | 60% × 5 |

The base rep targets are 5/5/5, 3/3/3, 5/3/1, and 5/5/5. A `+` uses the existing AMRAP flag with that minimum rep target, not an upper cap; the deload has no AMRAP sets. Users may turn AMRAP off for fixed-rep variants. These are ordinary editable week/set prescriptions, not a hard-coded 5/3/1 mode. Warmups and assistance work remain independently editable.

For a 200 lb TM, 5 lb work-set rounding, and a 45 lb minimum, the resolved work sets are 130/150/170 lb, 140/160/180 lb, 150/170/190 lb, and 80/100/120 lb respectively. Percentages always apply to TM, never to the preceding set or week's working weight. A floor that raises a deload weight still follows existing calculation rules and is visible in the preview.

The three work sets in a table row are **one exposure**, not three progression steps. Each set independently multiplies the same TM by its own percentage; never compound percentages. Each main lift traverses all four rows, including its own deload, before its TM proposal. If bench has completed week 2 but squat was skipped, the next launch can correctly show bench week 3 and squat week 2.

Programs may also prescribe multiple different exposures for one exercise within a week. For example, week 1 exposure A at 65/75/85% and exposure B at 50/60/70% must execute A, then B, then week 2—not advance a week after A or count individual sets as separate exposures. These are editable prescriptions, not hard-coded 5/3/1 modes. Later 5/3/1 variants and bundled programs are not required.

## Acceptance Criteria

- [ ] The phone-friendly editor can create, name, save, and edit cycles; choose a top-set or TM progression baseline; add/remove/duplicate weeks and within-week exposures; and edit exercises and ordered sets independently. Copying a workout, exposure, or week does not create a live link or modify its source.
- [ ] Each week explicitly specifies set counts, set types, fixed/ranged rep targets, AMRAP, and weight prescriptions. A three-week example of 3×8 at 70%, 4×6 at 75%, and 3×5 at 80% produces those exact structures; lighter recovery weeks are equally valid.
- [ ] Prescriptions reuse every existing `WeightBasis` option (top set, backoff, cross-reference, fixed, bar weight, relative offset) and add `trainingMax` everywhere bases are supported, including ordinary workouts. Calculated loads retain existing rounding, warmup rounding, and minimum rules; fixed/bar-weight values remain exact.
- [ ] TM and a separate TM increment are editable on shared exercise `LiftConfig`, with no cycle-owned defaults or implicit reuse of the normal increment. A missing, non-finite, or non-positive required TM blocks preview/start with an actionable error and no top-set fallback. A TM progression policy requires a configured, finite, nonnegative TM increment; zero explicitly means no increase. Exercises and ordinary prescriptions not using TM remain valid without these fields.
- [ ] The editor can express the complete four-week 5/3/1 table above, including independent percentages on all three sets, last-set AMRAP in weeks 1–3, and a non-AMRAP deload. Preview and execution show the week, rep target/AMRAP, percentage, clearly labeled TM basis, and resolved weight.
- [ ] Save/start validation accepts one or more weeks and rejects unnamed cycles/workouts, zero weeks, empty weeks/workouts/exercises, invalid rep ranges or weight prescriptions, and unresolved lift references with actionable errors, never silently dropping sets.
- [ ] Users preview any week/exposure without advancing and open/resume from familiar named cards. Single-week cards retain existing presentation; multi-week cards show week/total and distinguish diverged exercise stages. Independently progressing cycles remain usable without start/finish-run screens.
- [ ] Users schedule complete cycles through the calendar planner. Entries retain stable cycle and occurrence identity; calendar and Today's Plan resolve the next pending per-exercise prescriptions, not stale forecast weeks. Moving/missing dates does not change progress, and completion is occurrence-aware.
- [ ] Planning and Google synchronization preserve unrelated dates/events, cycle identity, distinct occurrences, and existing cardio/rest/blocker semantics. Google operations remain online-only; internal planning and cycle execution use existing offline behavior.
- [ ] Confirming a session advances only eligible exercises, once per exposure; skipped/partial exercises retain their prescriptions. Within-week exposures occur in order before the next week. Final exposure completion automatically rolls that exercise to its next iteration without waiting for other exercises or requiring a manual finish.
- [ ] The finish page explains current/next or retained stage for each exercise and shows only policy-appropriate baseline proposals. TM uses its separate increment at the exercise's completed boundary, after any deload; top-set progression retains applicable performance signals and ordinary per-session behavior. Manual working-weight changes cannot implicitly change TM.
- [ ] One baseline review per lift/iteration allows accept, keep, or a valid custom value. Results, progression, and accepted settings persist coherently; retries/reloads cannot increment twice. Baseline and stage updates never mutate historical snapshots.
- [ ] Mid-iteration edits to templates, shared inputs (including cross-references/rounding), or other cycles' progression leave frozen prescriptions and unfinished sessions unchanged. The UI explains that edits apply to future iterations; updated inputs are captured when an exercise begins its next iteration.
- [ ] User-scoped definitions, per-exercise iteration/position, frozen inputs, session context/results, and progression decisions survive reload and Firestore/offline synchronization. An unfinished session restores its original targets and results rather than silently substituting the next plan.
- [ ] Existing workouts, schedules, and logs remain usable without destructive migration. Normalize old definitions into individual one-week cycles without renaming them or rewriting history. History retains per-exercise cycle/iteration/week/exposure identity, planned templates/resolved targets, and actual results.
- [ ] Multi-week previous-session comparisons require matching cycle/iteration/week/exposure and corresponding exercise/set; absent or changed matches show no value, never another stage's set at the same index. Ordinary workouts retain existing comparisons across sessions.
- [ ] Tests cover all 12 example weights, distinct lift TMs, missing/invalid TM and TM increment, AMRAP/deload, rounding/minimums, variable sets, within-week ordering, independent/skipped/partial exercises, late calendar launches, mixed-stage cards/review, automatic rollover, frozen history/offline restoration, idempotent confirmation, and unchanged ordinary progression.

## Scope

### In scope
- Cycle authoring/validation, shared TM and separate increment, frozen per-exercise iterations, whole-cycle calendar planning, existing Google sync compatibility, execution/history/offline persistence, and stage-aware baseline review.
- Shared one-week/multi-week execution, per-exercise automatic exposure progression and rollover, and data-driven baseline policies.

### Out of scope
- Calendar-time advancement, automatic catch-up sessions/date shifting, adaptive programming, failure-based deloads, and unreviewed baseline increases.
- Editing already frozen prescriptions, cycle-specific sharing/import formats, bundled programs, and cross-device conflict merging beyond the existing offline last-committed-entity policy.

## Iteration decisions — 2026-09-21

- TM belongs to shared exercises and any weight prescription, not cycle-owned defaults. The follow-up explicitly selects a separate TM increment.
- The follow-up replaces provisional manual advancement/completion and fixed scheduled stages with automatic per-exercise progression. A missed prescription remains pending for the next launch; dates cannot advance a lift or force it to catch up.
- Individual one-week cycles are the accepted representation for ordinary workouts. Existing names/cards stay familiar; only multi-week cycles add week information. Remove the former global one-active-run limitation because independent workout cycles coexist.
- The normal finish confirmation is the only required progression interaction: identify each exercise's stage, apply the appropriate baseline policy, and roll completed iterations automatically. Separate stage progression from performance-qualified top-set increases and prescribed TM increases.
- Freeze each exercise's own iteration rather than a globally synchronized run. This permits one exercise to finish its deload and begin a new TM while another is still performing a missed earlier prescription.
- Ordered exposures within a week and independent per-set percentages are explicit. The classic 5/3/1 main-lift table advances once per completed row, and a configurable second exposure in a week must finish before that exercise advances to the next week.

## Notes

- Aligns with the manifesto's phone-first, data-driven plans rather than protocol-specific application logic.
- Existing “weekly” top/backoff bumps actually trigger when eligible workouts finish, not on a calendar-week timer (`src/model/progression.ts`; archived spec 011). Unification preserves that cadence for ordinary workouts.
- The 5/3/1 table describes the classic four-week main-lift template, not every program bearing that name; supporting this acceptance fixture does not require shipping a bundled program. Reference: [5/3/1 program overview](https://barbend.com/5-3-1-program/).
- Related: archived specs 001 (model), 005 (definitions), 011 (weight progression), 020 (editor), 030 (relative basis); spec 058 (offline). Grounding: `src/model/{types,compute,progression,logs}.ts`, `src/data/sample-workouts.ts`, `src/components/{WorkoutEditor,WorkoutView,CalendarView}.tsx`, `src/App.tsx`, and `src/firebase/store.ts`.
