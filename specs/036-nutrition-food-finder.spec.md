# Feature: Nutrition food finder (favorites / recents / search)

## What

Revamp the Nutrition page around three ways to find a food to log, all sourced
from the Open Food Facts (OFF) database:

1. **Favorites** (default view) — foods the user has starred.
2. **Recent** — a running list of the most recently logged OFF foods.
3. **Search** — free-text OFF search, the primary way to find new foods.

Three toggle buttons at the top of the page switch between these views, with
Favorites selected by default. Any food row (in any view) can be favorited or
unfavorited by tapping a star icon. To log a food, the user picks the meal
(Breakfast/Lunch/Dinner/Snacks/Drinks) and a servings quantity, then adds it.

The old organization of saved foods is removed: the saved-item library
(per-category expand/collapse panels), the "New Saved Item" form, custom foods,
and the "Quick Add" form all go away. The assumption is that a sufficient match
can always be found in the OFF database.

Only the five existing macros are tracked: calories, fat, carbs, fiber, protein.

## Decisions

- **Food identity.** A food is represented by a new `FoodItem` type keyed by its
  OFF `code` (barcode). Fields: `code`, `name`, `brand`, `servingLabel`, and the
  five per-serving macros. No meal category — the category is chosen at log time.
- **Favorites** are stored in a new `Stronger - Meal Favorites` tab and rewritten
  wholesale on every change. Starring adds a food; unstarring removes it (matched
  by `code`).
- **Recents** are stored in a new `Stronger - Meal Recents` tab, ordered
  most-recent-first, deduplicated by `code`, and capped at 50 entries. Logging a
  food moves/adds it to the front of the list.
- **Daily log** (`Stronger - Meal Log`) is unchanged: logging a food still
  appends a `MealLogEntry` (fresh id, date, chosen category, per-serving macros,
  quantity). The "Today's Meals" section and per-entry deletion are retained.
- **Removed storage.** The `Stronger - Meal Items` saved-item library tab is no
  longer read or written by the app (`readMealItems`/`writeMealItems` and its
  verify/create helpers are removed). Existing tabs in a user's sheet are left in
  place but ignored.
- **Goals.** The daily calorie/protein goal coloring in the totals bar is
  retained unchanged.

## Notes

- **Storage schema.** Both new tabs use columns `A:I`
  (`code`, `name`, `brand`, `servingLabel`, `calories`, `fat`, `carbs`, `fiber`,
  `protein`). Favorites and recents tabs are verified and auto-created when the
  Nutrition data loads (and on sheet connect) so existing users get them without
  a manual step.
- **Read/write model.** Favorites and recents are read wholesale and rewritten
  wholesale (`readMealFavorites`/`writeMealFavorites`,
  `readMealRecents`/`writeMealRecents`). The meal log continues to append/delete
  single rows.
- **Validation.** `parseFoodItemRow` drops rows with a blank `code` or `name`, or
  with any missing/non-finite/negative macro. `brand` and `servingLabel` may be
  blank.
- **UI.** A shared food-row renderer shows the food name/brand/serving/macros, a
  star toggle, a meal-category `select`, a servings `input` (default 1, fractional
  allowed), and an add button. Search retains the existing OFF staging
  `cgi/search.pl` endpoint and result parsing.

## Iteration: servings steppers and combined day entries (2026-07)

- Food finder rows show the serving size on its own line (`Serving: <label>`) so
  the quantity to specify is clear.
- The finder servings input has `−`/`+` buttons that step in 0.25 increments
  (clamped to a 0.25 minimum).
- "Today's Meals" combines duplicate foods (same meal, name, and per-serving
  calories) into a single line showing the summed servings. Logging an identical
  food merges into the existing log row by summing its quantity
  (`handleLogMealEntry`) rather than appending a new row; display-time grouping
  also collapses any pre-existing duplicate rows.
- Each combined day entry has `−`/`+` steppers (0.25 increments, 0.25 minimum)
  that adjust the underlying log row's quantity in place via a new
  `updateMealLogEntry` sheet helper, so servings can be changed without
  deleting and re-adding. The trash button deletes all rows in the group.

## Iteration: standard drinks tracking (2026-07)

- Added `standardDrinks: number` to `FoodItem` and `MealLogEntry` (per-serving count, 0 for non-alcoholic).
- OFF search responses are parsed for `alcohol_100g` and `alcohol_serving` nutriments. Standard drinks per serving are computed as `alcoholGrams / 14` (US standard: 1 drink = 14 g pure alcohol) and stored on both `FoodItem` and carried into the logged `MealLogEntry`.
- Favorites and Recents storage extended from 9 to 10 columns (A:J); `standardDrinks` is the new column J. Legacy 9-column rows default `standardDrinks` to 0.
- Meal Log extended from 10 to 11 columns (A:K); `standardDrinks` follows `quantity` at column K. Legacy rows without column K default to 0.
- The nutrition totals bar shows a 🍺 drinks line when any drinks are logged for the day or a goal is set: `X drinks today · Y this week [/ goal]`. The weekly count spans the Mon–Sun week containing the selected date.
- Weekly alcohol goal (`weeklyAlcoholGoal`) added to `AppSettings` and persisted in the Settings tab as `app.weeklyAlcoholGoal` (0–100, default 0). When set, the drinks line uses the same green/yellow/pink goal-coloring scheme as calories and protein.
- Settings page gains a "Weekly Drinks" field under Nutrition Goals.
