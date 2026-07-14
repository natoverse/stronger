import { useState, useEffect, useCallback } from 'react';

export type Route =
  | { view: 'list' }
  | { view: 'workout'; workoutId: string }
  | { view: 'calendar' }
  | { view: 'editor'; workoutId?: string }
  | { view: 'exercises' }
  | { view: 'exerciseEditor'; exerciseId?: string }
  | { view: 'progress' }
  | { view: 'settings' }
  | { view: 'garmin' }
  | { view: 'wellness' }
  | { view: 'withings' }
  | { view: 'nutrition' };

/**
 * Parse the current `window.location.hash` into a Route.
 *
 * Recognised patterns:
 *   (empty) | `#/`             → { view: 'list' }
 *   `#/workout/<id>`           → { view: 'workout', workoutId: id }
 *   `#/edit/new`               → { view: 'editor' }
 *   `#/edit/<id>`              → { view: 'editor', workoutId: id }
 *   `#/exercises`              → { view: 'exercises' }
 *   `#/exercise/new`           → { view: 'exerciseEditor' }
 *   `#/exercise/<id>`          → { view: 'exerciseEditor', exerciseId: id }
 *   anything else              → { view: 'list' }
 */
export function parseHash(hash: string = window.location.hash): Route {
  const stripped = hash.replace(/^#\/?/, '');
  if (!stripped) return { view: 'list' };

  if (stripped === 'calendar') return { view: 'calendar' };
  if (stripped === 'exercises') return { view: 'exercises' };
  if (stripped === 'progress') return { view: 'progress' };
  if (stripped === 'settings') return { view: 'settings' };
  if (stripped === 'garmin') return { view: 'garmin' };
  if (stripped === 'wellness') return { view: 'wellness' };
  if (stripped === 'withings') return { view: 'withings' };
  if (stripped === 'nutrition') return { view: 'nutrition' };

  if (stripped === 'edit/new') return { view: 'editor' };
  const editMatch = stripped.match(/^edit\/([^/]+)$/);
  if (editMatch) return { view: 'editor', workoutId: decodeURIComponent(editMatch[1]) };

  if (stripped === 'exercise/new') return { view: 'exerciseEditor' };
  const exerciseMatch = stripped.match(/^exercise\/([^/]+)$/);
  if (exerciseMatch) return { view: 'exerciseEditor', exerciseId: decodeURIComponent(exerciseMatch[1]) };

  const match = stripped.match(/^workout\/([^/]+)$/);
  if (match) return { view: 'workout', workoutId: decodeURIComponent(match[1]) };

  return { view: 'list' };
}

/** Convert a Route back to a hash string (without the leading `#`). */
export function routeToHash(route: Route): string {
  if (route.view === 'workout') return `/workout/${encodeURIComponent(route.workoutId)}`;
  if (route.view === 'calendar') return '/calendar';
  if (route.view === 'editor') return route.workoutId ? `/edit/${encodeURIComponent(route.workoutId)}` : '/edit/new';
  if (route.view === 'exercises') return '/exercises';
  if (route.view === 'progress') return '/progress';
  if (route.view === 'settings') return '/settings';
  if (route.view === 'garmin') return '/garmin';
  if (route.view === 'wellness') return '/wellness';
  if (route.view === 'withings') return '/withings';
  if (route.view === 'nutrition') return '/nutrition';
  if (route.view === 'exerciseEditor') return route.exerciseId ? `/exercise/${encodeURIComponent(route.exerciseId)}` : '/exercise/new';
  return '/';
}

/**
 * Lightweight hash-based router hook.
 *
 * - Reads the initial route from `window.location.hash`
 * - Listens for `hashchange` to stay in sync with browser navigation
 * - Provides `navigateTo` to push a new route (updates hash + state)
 * - Provides `replaceTo` to replace the current route without adding history
 */
export function useHashRouter() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => {
      setRoute((prev) => {
        const next = parseHash();
        // Skip update if the route is logically the same — avoids
        // redundant re-renders when navigateTo already called setRoute.
        if (routeToHash(prev) === routeToHash(next)) return prev;
        return next;
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** Push a new route — adds a history entry so the back button works. */
  const navigateTo = useCallback((r: Route) => {
    const hash = '#' + routeToHash(r);
    // Only push if the hash actually changed
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    setRoute(r);
  }, []);

  /** Replace the current route — does NOT add a history entry. */
  const replaceTo = useCallback((r: Route) => {
    const hash = '#' + routeToHash(r);
    window.history.replaceState(null, '', hash);
    setRoute(r);
  }, []);

  return { route, navigateTo, replaceTo } as const;
}
