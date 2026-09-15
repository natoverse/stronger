# Feature: Previous workout comparison

> Show the most recent previous weight and reps for each set inline when starting a workout, so the lifter has context on what they did last time.

## What

When a workout is started (e.g., Workout A — Bench Press), the app looks up the most recent completed workout with the same ID. For each set in the current workout, the previous actual weight and reps are displayed subtly alongside the planned values — think small muted text below or beside the main numbers.

This gives the lifter at-a-glance context: "Last time I hit 185 × 5 on this set" without cluttering the primary UI. If no previous workout exists for that ID (first time running it), the previous data is simply omitted.

## Acceptance Criteria

- [ ] When a workout is started, the app finds the most recent completed workout log with the same workout ID.
- [ ] For each set, the previous actual weight and reps are displayed inline with the current planned values.
- [ ] The previous data is visually secondary — smaller, muted, or otherwise clearly distinct from the current planned values.
- [ ] If no previous workout exists for that ID, no previous data is shown (no empty placeholders or error states).
- [ ] The previous data is read-only — it is context, not editable.

## Scope

### In scope
- Looking up the most recent completed workout by ID from Firestore session history
- Displaying previous weight and reps per set in the workout execution UI

### Out of scope
- Showing history beyond the most recent session (full workout history view)
- Trend lines, charts, or progress tracking visualizations
- Comparing across different workout IDs

## Notes

- This depends on completed sessions being saved to Firestore (per the workout execution flow). The lookup is by workout ID (A/B/C/D), ordered from the most recent session.
- "Same set" matching should be by position within the exercise — set 1 maps to set 1, etc. If the template has changed (e.g., a set was added), unmatched sets just don't show previous data.

## Post-merge iterations

- **Inline placement**: Previous set data was initially rendered on its own line below the set row. It was moved inline — first as a standalone element between the set-type select and the weight/rep fields, then moved inside the `.set-fields` container so it sits immediately to the left of the current lbs/reps inputs.
- **Format**: Displays as compact `{weight}×{reps}` (no "Last:" prefix) to save horizontal space.
- **Alignment**: The previous data sits inside the same flex container as the current fields, right-aligned as a group via `margin-left: auto` on `.set-fields`.
