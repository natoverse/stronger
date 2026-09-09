# Feature: Offline mode

> Load Stronger immediately from the last successful visit, keep every local
> function usable without a network, and synchronize changes when connectivity
> returns.

## What

Stronger persists its application shell, Firebase session, Firestore cache, and
pending mutations on the device. Startup renders cached user data first and
refreshes it in the background. Connectivity failures never replace usable
cached data or leave a blocking spinner on screen.

## Acceptance Criteria

- [ ] A previously visited deployment loads its application shell without a
      network connection.
- [ ] A persisted Firebase user can open cached data without waiting for token
      refresh or network availability.
- [ ] Route-priority Firestore reads render cached data first and refresh from
      the server in the background.
- [ ] A first offline visit with no cached application data shows an actionable
      empty-cache message rather than an endless loading state.
- [ ] Firestore uses persistent IndexedDB cache with multi-tab coordination.
- [ ] App mutations update the UI immediately and enter a durable, user-scoped
      pending-write queue.
- [ ] Pending writes survive reloads, synchronize after reconnection, and are
      applied idempotently.
- [ ] Superseded whole-entity mutations are coalesced by user and entity.
- [ ] Workout sessions use stable session documents so create, edit, and delete
      operations do not require online Firestore transactions.
- [ ] Legacy yearly workout-session buckets remain readable during migration.
- [ ] Imported Garmin, wellness, and Withings yearly buckets remain read-only in
      the browser.
- [ ] The toolbar reports offline, syncing, pending, synced, and reauthentication
      states without blocking navigation.
- [ ] Calendar authorization and synchronization remain explicitly online-only.
- [ ] Poor connectivity uses bounded attempts and cannot create overlapping
      refresh or synchronization loops.
- [ ] Explicit sign-out warns before abandoning pending writes and clears
      user-scoped local application state.
- [ ] Cache, authentication, write-queue, user-isolation, reconnect, and
      multi-tab behavior have automated coverage.

## Conflict Policy

Each mutable entity has a stable Firestore document identity. Locally queued
mutations are replayed in creation order after coalescing older changes for the
same entity. The last committed mutation for an entity wins. Workout-session
creates are idempotent because their document ID derives from the session key.

## Status UX

The connected toolbar shows a compact status control:

- **Offline** when the browser reports no connection.
- **Syncing** while server refresh or pending-write acknowledgement is active.
- **N changes pending** while local writes await acknowledgement.
- **Synced** with the last successful sync time after completion.
- **Sign in to sync** if cached data remains available after authentication is
  confirmed invalid.

Selecting the control retries synchronization. No status except a first-use
empty cache or unusable browser storage replaces the application UI.

## Application Shell

The production build emits a service worker with a versioned precache manifest.
Installation fills the replacement cache before activation. Navigation uses a
cached response immediately and refreshes it in the background; immutable build
assets are cache-first. Old caches are deleted only after the new cache has
installed successfully.

## Out of Scope

- Offline Google Calendar discovery or synchronization.
- Browser-side editing of imported health datasets.
- Cross-device conflict merging beyond last committed entity mutation.

## Additional Decisions

- Background caching fetches every Firestore dataset in full after the current
  route's priority data loads, including all schedule and day-flag dates.
- Startup immediately opens the last known user's cached data while Firebase
  restores authentication in the background; the observer then confirms or
  reconciles the session without keeping the app behind an auth spinner.
- Failed or stalled Google Calendar SDK loads are bounded and retryable.
  Reconnection retries preparation automatically, and the Calendar panel also
  provides an explicit retry action.
- Every deferred cache-first dataset load is followed by a server refresh while
  online. This warms uncached calendar months and updates mounted views as the
  refreshed schedule and day-flag state arrives.
