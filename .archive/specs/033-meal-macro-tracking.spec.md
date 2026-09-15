# Feature: Meal and macro tracking

Historical feature, retired by [spec 053](../../specs/053-remove-nutrition-tracking.spec.md). The decisions below record the removed nutrition feature; they do not describe active Firestore datasets.

## What

Add lightweight food and drink tracking for calories, fat, carbs, fiber, and protein.

## Decisions

- Saved foods and drinks belonged to a saved-item library; daily entries belonged to a separate meal log.
- Both records retain a name, one of Breakfast, Lunch, Dinner, Snacks, or Drinks, and all five macro values.
- Saved items are grouped by category and alphabetized for quick addition. Quick Add logs an arbitrary entry without saving it to the item library.

## Iteration: serving quantity, deletion, and layout (2026-07)

- Log entries carry a `quantity` field (servings). Macros are stored per serving and scaled by quantity for totals and display. Default 1; fractional values (e.g. 0.5) are allowed. Older log entries without the field default to 1.
- Serving quantity belongs to the logged entry, not the saved-item library.
- Logged meals can be deleted individually via `deleteMealLogEntry`, which removes the matching row by id.
- Saved items are shown in per-category expand/collapse panels (collapsed by default) so the library stays compact as it grows.
- The current day's logged meals live in a standalone "Today's Meals" section at the bottom of the page, separate from the saved-item panels.

## Notes

- **Domain schema**: Saved items retain `id`, `name`, `category`, `calories`, `fat`, `carbs`, `fiber`, and `protein`. Daily log entries also retain `date` and `quantity`.
- **Read/write model**: The original item library was replaced as a whole; log entries were added or removed individually by ID so past days were not rewritten en masse.
- **Validation (hardening)**: `parseMealValues` rejects a row when the name is blank, the category is not one of the five known categories, or any of the five macros is missing, non-finite, or negative. Item rows additionally require an `id`; log rows additionally require a `date`. Invalid rows are dropped on read rather than throwing. Macro form inputs are `required`, numeric, and `min="0"`.
- **IDs**: new items and entries use `crypto.randomUUID()` with a collision-resistant fallback (timestamp plus two random suffixes) for environments without the WebCrypto API. Logging a saved item clones it with a fresh id so edits/duplicates never collide.

## Iteration log

- Feature shipped in `Add meal and macro tracking`, then refined by polish commits: hardened meal entry validation (reject blank/unknown/negative rows), avoided fallback meal ID collisions, polished the Quick Add form, and aligned the macro field labels. Serving quantity, per-entry deletion, collapsible category panels, and the standalone "Today's Meals" section followed (see the iteration section above).

## Iteration: daily calorie/protein goals in settings (2026-07)

- Added two app-level nutrition settings (`app.dailyCalorieGoal`, `app.dailyProteinGoalGrams`) with defaults of `0` (disabled).
- The Nutrition summary now colors calorie/protein progress against goals: green when within 10% of the target, yellow when outside that band, and pink for calories when intake exceeds the calorie goal.
- Goals are configured in Settings under a new Nutrition Goals section, and the daily totals now show current value alongside goal when configured.

## Iteration: optional nutrition tab visibility (2026-07)

- Added a toolbar visibility toggle for Nutrition in Settings, persisted as `app.showNutritionTab`.
- The Nutrition tab was off by default for all users unless explicitly enabled.

## Iteration: Open Food Facts search endpoint (2026-07)

- Nutrition keyword search now uses the Open Food Facts staging v3 endpoint `https://world.openfoodfacts.net/api/v3/search` instead of the legacy `cgi/search.pl` route.
- Requests use the documented `q`, `page_size`, and `fields` query parameters and include the staging basic-auth header `off:off`.

## Iteration: revert search to cgi/search.pl (2026-07)

- The `/api/v3/search` endpoint returned HTTP 400 with `invalid_api_action` (`search` is not a valid v3 API action — OFF v3 has no free-text search endpoint).
- Reverted keyword search back to the staging `https://world.openfoodfacts.net/cgi/search.pl` route, which supports free-text search and returns the same `{ products: [...] }` shape the parser already expects.
- Query params are now `search_terms`, `search_simple=1`, `action=process`, `json=1`, plus the existing `page_size` and `fields`. The `off:off` basic-auth header is retained for the staging host.

## Superseded: food finder revamp (2026-07)

- The saved-item library and its per-category expand/collapse panels, the "New Saved Item" form, and the "Quick Add" form were removed in favor of an OFF-database food finder (favorites / recent / search). See [spec 036](036-nutrition-food-finder.spec.md).
- The daily log, serving quantities, per-entry deletion, and calorie/protein goal coloring carried over unchanged.
