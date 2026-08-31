# Feature: Exercise-specific warmup rounding

> Give warmup sets their own exercise-level rounding factor while preserving the existing rounding factor for all other set types.

## What

Warmup weights should not inherit an exercise's standard rounding factor. Each exercise gets a `warmupRoundingFactor` setting, editable alongside its existing weight settings and stored in the Exercises sheet. Warmup sets use this factor before optional easy-plate-math snapping; work, backoff, and joker sets continue to use `roundingFactor`.

Existing sheet rows without the new value and newly created exercises default warmup rounding to 5 lbs.

## Acceptance Criteria

- [ ] Each exercise has an editable warmup rounding factor.
- [ ] New exercises default warmup rounding to 5 lbs.
- [ ] Existing exercise rows with no warmup rounding value load with a 5 lb default.
- [ ] Any calculated set tagged `warmup` uses the warmup rounding factor.
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
