# Remove nutrition tracking

## What

Remove nutrition tracking from Stronger so the app remains focused on training, activity, and wellness data.

## Decisions

- Preserve the last nutrition-enabled revision with the `pre-nutrition-removal` Git tag.
- Remove the Nutrition route, toolbar entry, settings, views, charts, models, load-plan datasets, and Google Sheets/Firestore access code.
- Stop creating, reading, writing, migrating, or benchmarking nutrition data.
- Leave existing nutrition tabs and Firestore collections untouched. Removing the feature must not delete user data.
- Archive the superseded nutrition feature specs for historical reference.

## Acceptance criteria

- Nutrition cannot be opened or enabled in the app.
- No nutrition data is loaded or written.
- Nutrition-specific production code, styles, and tests are removed.
- Existing non-nutrition behavior continues to pass tests and build successfully.
