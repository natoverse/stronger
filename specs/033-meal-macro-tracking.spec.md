# Feature: Meal and macro tracking

## What

Add lightweight food and drink tracking for calories, fat, carbs, fiber, and protein.

## Decisions

- Saved foods and drinks live in `Stronger - Meal Items`; daily entries live in `Stronger - Meal Log`.
- Both records retain a name, one of Breakfast, Lunch, Dinner, Snacks, or Drinks, and all five macro values.
- Saved items are grouped by category and alphabetized for quick addition. Quick Add logs an arbitrary entry without saving it to the item library.

## Iteration: serving quantity, deletion, and layout (2026-07)

- Log entries carry a `quantity` field (servings). Macros are stored per serving and scaled by quantity for totals and display. Default 1; fractional values (e.g. 0.5) are allowed. Legacy log rows without the column default to 1.
- The meal log tab gained a `quantity` column (now spans A:J instead of A:I). The meal items library tab is unchanged (A:H).
- Logged meals can be deleted individually via `deleteMealLogEntry`, which removes the matching row by id.
- Saved items are shown in per-category expand/collapse panels (collapsed by default) so the library stays compact as it grows.
- The current day's logged meals live in a standalone "Today's Meals" section at the bottom of the page, separate from the saved-item panels.
