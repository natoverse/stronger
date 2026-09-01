# Feature: Exercise-specific warmup rounding

> Give warmup sets their own exercise-level rounding factor while preserving the existing rounding factor for all other set types.

## What

Warmup weights should not inherit an exercise's standard rounding factor. Each exercise gets a `warmupRoundingFactor` setting, editable alongside its existing weight settings and stored in the Exercises sheet. When easy plate math is enabled, calculated warmup weights first snap to a standard plate combination if their raw weight is within 5 lbs; otherwise they fall back to `warmupRoundingFactor`. Work, backoff, and joker sets continue to use `roundingFactor`.

Existing sheet rows without the new value and newly created exercises default warmup rounding to 5 lbs.

## Acceptance Criteria

- [ ] Each exercise has an editable warmup rounding factor.
- [ ] New exercises default warmup rounding to 5 lbs.
- [ ] Existing exercise rows with no warmup rounding value load with a 5 lb default.
- [ ] Any calculated set tagged `warmup` uses the warmup rounding factor.
- [ ] When easy plate math is enabled, a nearby standard plate combination takes precedence and warmup rounding is only the fallback.
- [ ] Work, backoff, and joker sets continue to use the standard rounding factor.
- [ ] Fixed and bar-weight sets preserve their explicit configured weights.
- [ ] The Exercises sheet header and range include the new setting.

## Scope

### In scope

- Exercise configuration model and defaults
- Exercises sheet serialization and backward-compatible parsing
- Exercise editor field
- Set weight calculation and regression coverage

### Out of scope

- Changes to progression increments
- Changes to easy-plate-math snapping behavior
- Per-workout or per-set rounding overrides

## Additional decisions

- Existing sheets may already contain unrelated values in column J from before `warmupRoundingFactor` was added. A missing or invalid value in that optional column defaults to 5 lbs instead of discarding the entire exercise row.
