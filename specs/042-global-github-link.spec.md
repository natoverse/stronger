# Feature: Global GitHub Link

> Make the Stronger source repository accessible from every app view.

## What

The existing GitHub repository link moves from the workout selection screen into a shared footer. The footer is rendered after every app view, including authentication, setup, workout, editor, calendar, progress, activity, and settings screens.

## Acceptance Criteria

- [x] Every app view displays a GitHub link at the bottom of the page
- [x] The link opens `https://github.com/natoverse/stronger` in a new tab
- [x] The workout selection screen does not display a duplicate link

## Scope

### In scope

- Shared app footer
- Existing GitHub link styling and icon

### Out of scope

- Additional footer navigation
- Repository metadata or version display

## Post-merge iterations

- The shared footer was removed. A logo-only GitHub link now occupies the right side of the connected header.
