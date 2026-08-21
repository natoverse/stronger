# Feature: Month view calendar

> Add an at-a-glance monthly schedule above the existing detailed day list.

## Acceptance Criteria

- [x] The schedule page shows the current month by default.
- [x] Each day shows one dot per scheduled workout.
- [x] “Show next month” appends the following month below the existing calendars and can be used repeatedly.
- [ ] Each appended month has a close control that removes only that month; the current month remains fixed.
- [x] An activities-style multi-select lists every workout type present in the schedule.
- [x] Selecting workout types controls which dots appear without changing the saved schedule or detailed day list.
- [ ] Strength workouts use pink dots, cardio workouts use blue dots, and rest uses grey dots.
- [ ] The current-day marker is grey so it is visually distinct from workout dots.
- [ ] Selecting a day opens a compact list of that day's scheduled workout names.
- [ ] Active day flags appear as a row of color-coded squares below the workout dots.
- [ ] A control next to the workout filter toggles month-view flag squares without changing saved flags.

## Notes

- The existing day list remains the place to assign, remove, open, and inspect workouts.
- Month calendars use the persisted workout schedule and include strength, cardio, rest, and unknown legacy workout IDs.

## Iteration: month calendar legibility and controls

- Future months are tracked independently so removing one does not renumber or remove the other visible months. “Show next month” always appends the month after the furthest one currently shown.
- Day details are opened by click or keyboard activation and use workout names from the same lookup as the detailed calendar.
- Flag squares reuse the established flag colors: home green, elsewhere orange, travel pink, visitors purple, alcohol blue, and blocked red.
