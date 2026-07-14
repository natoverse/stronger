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

## Notes

- **Storage schema**: `Stronger - Meal Items` stores the saved-item library at columns `A:H` (`id`, `name`, `category`, `calories`, `fat`, `carbs`, `fiber`, `protein`). `Stronger - Meal Log` stores daily entries at columns `A:J` (`date`, the same eight item columns, then `quantity`). Both tabs are verified and auto-created on sheet connect.
- **Read/write model**: the item library is rewritten wholesale (`writeMealItems`); log entries are appended one row at a time (`appendMealLogEntry`) and removed by id (`deleteMealLogEntry`), so past days are never rewritten en masse. `readMealLog` reads from `A2:J` and tolerates trailing/blank rows.
- **Validation (hardening)**: `parseMealValues` rejects a row when the name is blank, the category is not one of the five known categories, or any of the five macros is missing, non-finite, or negative. Item rows additionally require an `id`; log rows additionally require a `date`. Invalid rows are dropped on read rather than throwing. Macro form inputs are `required`, numeric, and `min="0"`.
- **IDs**: new items and entries use `crypto.randomUUID()` with a collision-resistant fallback (timestamp plus two random suffixes) for environments without the WebCrypto API. Logging a saved item clones it with a fresh id so edits/duplicates never collide.

## Iteration log

- Feature shipped in `Add meal and macro tracking`, then refined by polish commits: hardened meal entry validation (reject blank/unknown/negative rows), avoided fallback meal ID collisions, polished the Quick Add form, and aligned the macro field labels. Serving quantity, per-entry deletion, collapsible category panels, and the standalone "Today's Meals" section followed (see the iteration section above).

## Iteration: daily calorie/protein goals in settings (2026-07)

- Added two app-level nutrition settings persisted in the Settings tab (`app.dailyCalorieGoal`, `app.dailyProteinGoalGrams`) with defaults of `0` (disabled).
- The Nutrition summary now colors calorie/protein progress against goals: green when within 10% of the target, yellow when outside that band, and pink for calories when intake exceeds the calorie goal.
- Goals are configured in Settings under a new Nutrition Goals section, and the daily totals now show current value alongside goal when configured.
