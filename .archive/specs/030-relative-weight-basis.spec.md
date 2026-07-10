# Feature: Relative weight basis

> Add a "relative" weight basis that applies a fixed plus/minus offset to a lift's own top-set or backoff weight, complementing the existing fixed and percentage-of options.

## What

Today a set's weight can be derived as a percentage of the top set, a percentage of the backoff weight, a cross-reference to another lift, a fixed absolute weight, or the bar weight. There is no way to express "the same as my backoff, minus 20 lbs" or "top set plus 5 lbs" without hard-coding an absolute number that drifts out of date whenever the reference weight progresses.

This spec adds a `relative` weight basis. A relative set references the lift's own top-set or backoff weight and applies a signed offset (in lbs). The computed weight is `reference + offset`, then rounded to the lift's rounding factor and clamped to its minimum. The set's percentage is ignored for relative sets, mirroring how it is ignored for `fixed` and `barWeight`.

## Acceptance Criteria

- [x] `WeightBasis` gains a `{ kind: 'relative'; reference: 'topSet' | 'backoff'; offset: number }` variant.
- [x] `computeSetWeight` resolves a relative set as `reference + offset`, rounded and clamped like other bases. Offsets may be negative.
- [x] The weight basis serializes to/from the sheet as `relative:<reference>:<offset>` (e.g. `relative:backoff:-20`).
- [x] The workout editor exposes "Top set ±" and "Backoff ±" basis options with an offset input, and disables the percentage field for relative sets.

## Scope

### In scope
- New `relative` `WeightBasis` variant in the data model
- Weight computation for relative sets (round + clamp)
- Sheet serialization (`encodeWeightBasis` / `decodeWeightBasis`)
- Workout editor UI (basis dropdown options + offset input)
- Unit tests for compute and serialization

### Out of scope
- Cross-referencing another lift with an offset (the offset applies only to the same lift's own top-set/backoff weight)
- Progression signals for relative sets — like cross-reference sets, relative sets derive from a reference weight and do not independently drive progression proposals

## Notes

- Serialization format: `relative:<reference>:<offset>` where `<reference>` is `topSet` or `backoff` and `<offset>` is a signed number. Unlike `fixed`, negative values are valid for the offset.
- The percentage field is ignored (and disabled in the editor) for relative sets, consistent with `fixed` and `barWeight`.
