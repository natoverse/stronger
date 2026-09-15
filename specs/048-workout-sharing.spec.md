# Feature: Workout sharing

> Share a portable workout definition by URL and let another Stronger user import an independent copy.

- Closes #405

## What

The workout list's three-dot menu includes **Share**, which creates a URL containing the workout definition without depending on authentication or access to the sender's Firestore data. Opening that URL detects the shared workout, waits until the recipient's authenticated user data is available, and asks whether to import it.

Accepting adds the workout to the recipient's workout list with a fresh ID. The portable payload preserves the workout's name, optional favorite state, and complete exercise and set templates required by `WorkoutDefinition`; the source ID is not reused. If the name already exists, the imported name has ` copy` appended.

## Acceptance Criteria

- [x] Every workout's three-dot menu offers **Share** and produces an auth-independent URL containing its portable definition.
- [x] Opening a valid shared-workout URL prompts to import only after the user's authenticated data is available.
- [x] Accepting writes a new workout to the recipient's Firestore data and shows it in the workout list with a fresh ID.
- [x] The imported copy preserves the shared name, optional favorite state, and complete ordered exercise/set templates.
- [x] If the shared name already exists, the imported workout is named `<name> copy`.
- [x] Declining makes no changes, and malformed or unsupported payloads are rejected safely without writing to Firestore.

## Scope

### In scope
- Sharing and importing one workout definition by URL
- Validation, duplicate-name handling, and fresh imported IDs

### Out of scope
- Sharing workout history, schedules, exercise configuration, or account access
- Accounts, hosted links, collaboration, or social discovery

## Notes

The URL is portable data, not authorization. This keeps sharing client-only and leaves each user's Firestore data as their source of truth.

The implemented route is `#/import/<payload>`, where `payload` is versioned UTF-8 JSON encoded as base64url and omits the source workout ID. Sharing uses the native share sheet when available, then falls back to clipboard or a copy prompt. Further name collisions use `<name> copy 2`, `<name> copy 3`, and so on.

## Firestore-only iteration (2026-09-15)

- Import writes only to the recipient's authenticated UID. Portable payload validation, fresh IDs, collision naming, and native device sharing remain unchanged.
