# Feature: Meal and macro tracking

## What

Add lightweight food and drink tracking for calories, fat, carbs, fiber, and protein.

## Decisions

- Saved foods and drinks live in `Stronger - Meal Items`; daily entries live in `Stronger - Meal Log`.
- Both records retain a name, one of Breakfast, Lunch, Dinner, Snacks, or Drinks, and all five macro values.
- Saved items are grouped by category and alphabetized for quick addition. Quick Add logs an arbitrary entry without saving it to the item library.

## Notes

- **Storage schema**: `Stronger - Meal Items` stores the saved-item library at columns `A:H` (`id`, `name`, `category`, `calories`, `fat`, `carbs`, `fiber`, `protein`). `Stronger - Meal Log` stores daily entries at columns `A:I` (`date`, then the same eight item columns). Both tabs are verified and auto-created on sheet connect.
- **Read/write model**: the item library is rewritten wholesale (`writeMealItems`), while log entries are append-only (`appendMealLogEntry`) so past days are never rewritten. `readMealLog` reads from `A2:I` and tolerates trailing/blank rows.
- **Validation (hardening)**: `parseMealValues` rejects a row when the name is blank, the category is not one of the five known categories, or any of the five macros is missing, non-finite, or negative. Item rows additionally require an `id`; log rows additionally require a `date`. Invalid rows are dropped on read rather than throwing. Macro form inputs are `required`, numeric, and `min="0"`.
- **IDs**: new items and entries use `crypto.randomUUID()` with a collision-resistant fallback (timestamp plus two random suffixes) for environments without the WebCrypto API. Logging a saved item clones it with a fresh id so edits/duplicates never collide.
- **UI**: the Nutrition view (route `#/nutrition`, reachable from a toolbar button) has a date picker capped at today, a running daily macro totals bar, per-category sections listing saved items as one-tap "add" buttons plus that day's logged entries, a collapsible "New Saved Item" form, and a "Quick Add" form that logs an arbitrary entry without persisting it to the library. Macro field labels read "Calories" and "<Macro> (g)".

## Iteration log

- Feature shipped in `Add meal and macro tracking`, then refined by follow-up polish commits: hardened meal entry validation (reject blank/unknown/negative rows), avoided fallback meal ID collisions, polished the Quick Add form, and aligned the macro field labels. These decisions are captured in the Notes section above.
