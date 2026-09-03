# Feature: Month view calendar

> Add an at-a-glance monthly schedule above the existing detailed day list.

## Acceptance Criteria

- [x] The schedule page shows the current month by default.
- [x] Each day shows one dot per scheduled workout.
- [x] “Show next month” appends the following month below the existing calendars and can be used repeatedly.
- [x] Each appended month has a close control that removes only that month; the current month remains fixed.
- [x] An activities-style multi-select lists every workout type present in the schedule.
- [x] Selecting workout types controls which dots appear without changing the saved schedule or detailed day list.
- [x] Strength workouts use pink dots, cardio workouts use blue dots, and rest uses grey dots.
- [x] The current-day marker is grey so it is visually distinct from workout dots.
- [x] Selecting a day scrolls its detailed workout schedule card into view below the month calendar.
- [x] Active day flags appear as a row of color-coded squares below the workout dots.
- [x] A control next to the workout filter toggles month-view flag squares without changing saved flags.

## Notes

- The existing day list remains the place to assign, remove, open, and inspect workouts.
- Month calendars use the persisted workout schedule and include strength, cardio, rest, and unknown legacy workout IDs.

## Iteration: month calendar legibility and controls

- Future months are tracked independently so removing one does not renumber or remove the other visible months. “Show next month” always appends the month after the furthest one currently shown.
- Day selection works by click or keyboard activation. Dates outside the initially rendered detail range are added to the detailed list before their card is scrolled into view.
- Flag squares reuse the established flag colors: home green, elsewhere orange, travel pink, visitors purple, alcohol blue, and blocked red.

## Iteration: fixed controls and aligned flags

- Every month day reserves five flag squares in the same order as the detailed day cards. Inactive flags are grey so active colors never shift position.
- A compact “Monthly” toolbar control toggles the monthly calendar without changing its filters or visible-month state.
- The toolbar, open management panel, and optional month calendar remain fixed while the detailed day cards scroll independently below them.
- Selecting a month day scrolls its card within the independent detailed-day region, leaving the month calendar visible.

## Iteration: persistent app navigation and consistent calendar controls

- The main app tab bar remains fixed at the top while page content scrolls.
- Time range and aggregation controls remain fixed directly below the tab bar on pages that provide them.
- Calendar management controls continue to expand and collapse their associated content, including the monthly view.
- Historical schedule days are loaded from a control at the top of the detailed card list rather than from the fixed calendar toolbar.

## Iteration: consistent toolbar tabs

- Monthly behaves like Plan, Sync, and Clear: selecting any toolbar tab closes the active tab and opens the selected one, while selecting the active tab closes it.

## Iteration: toolbar-controlled panels

- Plan, Sync, and Clear no longer render redundant close buttons; their corresponding toolbar tabs are the sole visibility toggles.

## Iteration: hide alcohol day flag

- The alcohol day flag remains in the persisted data model and sheet schema, but is not shown or editable from daily cards or the monthly calendar.

## Iteration: scheduled workout tags

- Each day renders up to two scheduled workouts as stacked, full-width labeled tags rather than dots.
- Strength and cardio tags retain their existing pink and blue colors, with black text for contrast.

## Iteration: compact scheduled workout tags

- Month-view workout tags use smaller text, minimal vertical and horizontal padding, and subtly rounded corners.
- Labels that exceed the available width are clipped without an ellipsis.

## Iteration: exclusive location display

- Home, elsewhere, and travel are edited as mutually exclusive location options. If legacy data contains multiple locations, the last active option in home → elsewhere → travel order wins.
- Month days no longer show flag squares or a flag visibility toggle.
- A single compact, full-color location icon appears to the left of the right-aligned day number, using the same icon and color for every location.

## Iteration: wider scheduled workout tags

- Month-view workout tags use the full available day-cell width so more of each label remains visible.

## Iteration: distinct location icons

- Month days use a green house for home, an orange palm tree for elsewhere, and a red airplane for travel.

## Iteration: default home location

- Days without an explicit home, elsewhere, or travel flag display as home in both the monthly calendar and detailed day list.

## Iteration: full-width schedule panels

- Schedule toolbar controls, management panels, and month calendars align with the full width of the detailed day-list cards.

## Iteration: monthly toolbar position

- Monthly is the leftmost control in the schedule toolbar.

## Iteration: activity ordering and day status

- Cardio activities are always shown before strength workouts in both month cells and detailed day lists, independent of sheet order. Rest follows both activity types.
- Month cells show up to three workout tags and are slightly taller to accommodate the additional tag.
- Month headers show the purple visitors icon beside the location icon, and blocked dates use a red day number.
- Travel icons use the neon yellow accent in both month headers and detailed day-list controls.

## Iteration: consolidate schedule planning controls

- Clear schedule controls appear below the schedule-filling controls within the Plan panel.
- Clear is no longer a separate schedule toolbar tab.
- The Plan panel uses a taller scroll area to accommodate both sets of controls.

## Iteration: continuous detail-day navigation

- Selecting a month day outside the loaded detail-day range loads every intervening day before scrolling to the selected card.
- The detail-day list remains continuous when navigating either forward or backward.

## Iteration: load selected month remainder

- Selecting a month day loads detailed cards through the final day of that month before scrolling to the selected card.

## Iteration: three-month schedule default (superseded)

- The monthly calendar initially shows the current month and the following two months.
- The detailed day list initially loads the next 90 days, matching the three-month planning horizon.

## Iteration: 60-day windowed loading

- The monthly view opens with the current month, while the detailed day list
  extends from today through the end of the loaded window.
- The initial 60-day data window begins on the first of the current month so
  past dates shown in the default monthly calendar include schedule and flag
  data.
- "Show next month" and "Load more days" perform the same action: both add one
  month to the monthly view, add 30 detailed days, and request the next 30 days
  of schedule and day-flag data.
- "Load previous days" adds and requests 30 days at a time.

## Iteration: scheduled workout names

- Scheduled strength workouts resolve display names from the persisted workout definitions, even when a workout cannot be computed for execution.
- Workout IDs remain the fallback only for legacy schedule entries that have no matching definition.
