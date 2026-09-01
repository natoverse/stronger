# Feature: Workout sharing

> Share a portable workout definition by URL and let another Stronger sheet import its own copy.

- Closes #405

## What

The workout list's three-dot menu includes **Share**, which creates a URL containing the workout definition without depending on authentication or access to the sender's Google Sheet. Opening that URL detects the shared workout, waits until the recipient's Stronger sheet is available, and asks whether to import it.

Accepting adds the workout to the recipient's workout list with a fresh ID. The portable payload preserves the workout's name, optional favorite state, and complete exercise and set templates required by `WorkoutDefinition`; the source ID is not reused. If the name already exists, the imported name has ` copy` appended.

## Acceptance Criteria

- [ ] Every workout's three-dot menu offers **Share** and produces an auth-independent URL containing its portable definition.
- [ ] Opening a valid shared-workout URL prompts to import only after the user's Stronger sheet is available.
- [ ] Accepting writes a new workout to the sheet and shows it in the workout list with a fresh ID.
- [ ] The imported copy preserves the shared name, optional favorite state, and complete ordered exercise/set templates.
- [ ] If the shared name already exists, the imported workout is named `<name> copy`.
- [ ] Declining makes no changes, and malformed or unsupported payloads are rejected safely without writing to the sheet.

## Scope

### In scope
- Sharing and importing one workout definition by URL
- Validation, duplicate-name handling, and fresh imported IDs

### Out of scope
- Sharing workout history, schedules, exercise configuration, or sheet access
- Accounts, hosted links, collaboration, or social discovery

## Notes

The URL is portable data, not authorization. This keeps sharing client-only and leaves each user's Google Sheet as their source of truth.
