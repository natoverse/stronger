# Feature: Editable set type with joker sets

> Allow the lifter to change a set's type via a dropdown on the label, and add "joker" as a fourth set type for bonus sets on a good day.

## What

During a workout, each set displays its type (warmup, work, backoff). Tapping the set type label opens a dropdown with all available options: warmup, work, backoff, and the new "joker" type. The lifter selects a new type and it updates immediately.

Joker sets are unplanned bonus sets added when the lifter is feeling strong. They aren't part of the standard workout template — they're an in-session override. The joker type is available in the dropdown but not used in any templates or computed workouts yet.

When the workout is saved, each set's actual type (including any changes or joker additions) is recorded in the workout log.

## Acceptance Criteria

- [ ] Tapping a set type label opens a dropdown with the options: warmup, work, backoff, joker.
- [ ] Selecting an option updates the set type immediately in the UI.
- [ ] The "joker" set type is a new valid type in the data model.
- [ ] The saved workout log includes the actual set type for each set (reflecting any changes made during the session).
- [ ] The dropdown is thumb-friendly on mobile — large enough tap targets, no fiddly interactions.

## Scope

### In scope
- Set type dropdown on the set type label
- Adding "joker" as a fourth set type to the data model
- Persisting the actual set type in the workout log on save

### Out of scope
- Adding new sets during a workout (e.g., inserting a joker set row)
- Joker set logic in workout templates or computed workouts
- Progression rules that account for joker sets

## Notes

- Joker sets are a concept from 5/3/1 and similar programs — extra heavy singles/doubles when the lifter feels good. For now it's just a label; no computation or progression logic is attached.
- Consider whether changing a warmup to "work" mid-session has implications for the saved log. For v1, just record whatever the user picked — no validation.

## Post-merge iterations

- **Dropdown arrow removed**: The native `<select>` dropdown arrow was hidden via `appearance: none` for a cleaner pill-like appearance.
- **Text centering**: `text-align-last: center` was added (in addition to `text-align: center`) because mobile browsers ignore `text-align` on `<select>` elements. A `min-width: 5rem` was also added to give the text room to visually center.
