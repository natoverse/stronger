# Feature: Meal and macro tracking

## What

Add lightweight food and drink tracking for calories, fat, carbs, fiber, and protein.

## Decisions

- Saved foods and drinks live in `Stronger - Meal Items`; daily entries live in `Stronger - Meal Log`.
- Both records retain a name, one of Breakfast, Lunch, Dinner, Snacks, or Drinks, and all five macro values.
- Saved items are grouped by category and alphabetized for quick addition. Quick Add logs an arbitrary entry without saving it to the item library.
