# Feature: Month view calendar

> Add an at-a-glance monthly schedule above the existing detailed day list.

## Acceptance Criteria

- [x] The schedule page shows the current month by default.
- [x] Each day shows one dot per scheduled workout.
- [x] “Show next month” appends the following month below the existing calendars and can be used repeatedly.
- [x] An activities-style multi-select lists every workout type present in the schedule.
- [x] Selecting workout types controls which dots appear without changing the saved schedule or detailed day list.

## Notes

- The existing day list remains the place to assign, remove, open, and inspect workouts.
- Month calendars use the persisted workout schedule and include strength, cardio, rest, and unknown legacy workout IDs.
