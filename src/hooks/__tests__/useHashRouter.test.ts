import { describe, it, expect } from 'vitest';
import { getSettingsRouteRedirect, parseHash, routeToHash } from '../useHashRouter.js';
import type { Route } from '../useHashRouter.js';

/* ------------------------------------------------------------------ */
/*  parseHash – pure function, no DOM required                         */
/* ------------------------------------------------------------------ */

describe('parseHash', () => {
  it('returns list for empty string', () => {
    expect(parseHash('')).toEqual({ view: 'list' });
  });

  it('returns list for bare hash', () => {
    expect(parseHash('#')).toEqual({ view: 'list' });
  });

  it('returns list for root path', () => {
    expect(parseHash('#/')).toEqual({ view: 'list' });
  });

  it('parses a workout route', () => {
    expect(parseHash('#/workout/squat-a')).toEqual({
      view: 'workout',
      workoutId: 'squat-a',
    });
  });

  it('parses a workout route without leading slash', () => {
    expect(parseHash('#workout/bench-b')).toEqual({
      view: 'workout',
      workoutId: 'bench-b',
    });
  });

  it('parses a shared workout import route', () => {
    expect(parseHash('#/import/abc_123-XYZ')).toEqual({
      view: 'import',
      data: 'abc_123-XYZ',
    });
  });

  it('decodes percent-encoded workout IDs', () => {
    expect(parseHash('#/workout/my%20workout')).toEqual({
      view: 'workout',
      workoutId: 'my workout',
    });
  });

  it('parses the calendar route', () => {
    expect(parseHash('#/calendar')).toEqual({ view: 'calendar' });
  });

  it('parses the calendar route without leading slash', () => {
    expect(parseHash('#calendar')).toEqual({ view: 'calendar' });
  });

  it('parses the editor new route', () => {
    expect(parseHash('#/edit/new')).toEqual({ view: 'editor' });
  });

  it('parses the editor new route without leading slash', () => {
    expect(parseHash('#edit/new')).toEqual({ view: 'editor' });
  });

  it('parses an editor edit route', () => {
    expect(parseHash('#/edit/workout-a')).toEqual({
      view: 'editor',
      workoutId: 'workout-a',
    });
  });

  it('decodes percent-encoded editor workout IDs', () => {
    expect(parseHash('#/edit/my%20workout')).toEqual({
      view: 'editor',
      workoutId: 'my workout',
    });
  });

  it('returns list for unknown routes', () => {
    expect(parseHash('#/unknown')).toEqual({ view: 'list' });
    expect(parseHash('#/workout/')).toEqual({ view: 'list' });
    expect(parseHash('#/workout/a/b')).toEqual({ view: 'list' });
  });

  it('parses the exercises list route', () => {
    expect(parseHash('#/exercises')).toEqual({ view: 'exercises' });
  });

  it('parses the exercises list route without leading slash', () => {
    expect(parseHash('#exercises')).toEqual({ view: 'exercises' });
  });

  it('parses the progress route', () => {
    expect(parseHash('#/progress')).toEqual({ view: 'progress' });
  });

  it('parses the progress route without leading slash', () => {
    expect(parseHash('#progress')).toEqual({ view: 'progress' });
  });

  it('parses the settings route', () => {
    expect(parseHash('#/settings')).toEqual({ view: 'settings' });
  });

  it('parses the settings route without leading slash', () => {
    expect(parseHash('#settings')).toEqual({ view: 'settings' });
  });

  it('parses the exercise editor new route', () => {
    expect(parseHash('#/exercise/new')).toEqual({ view: 'exerciseEditor' });
  });

  it('parses the exercise editor edit route', () => {
    expect(parseHash('#/exercise/bench')).toEqual({
      view: 'exerciseEditor',
      exerciseId: 'bench',
    });
  });

  it('decodes percent-encoded exercise IDs', () => {
    expect(parseHash('#/exercise/bench%20press')).toEqual({
      view: 'exerciseEditor',
      exerciseId: 'bench press',
    });
  });

  it('ignores trailing content after workout ID with extra slashes', () => {
    expect(parseHash('#/workout/squat-a/extra')).toEqual({ view: 'list' });
  });
});

/* ------------------------------------------------------------------ */
/*  routeToHash – pure function                                        */
/* ------------------------------------------------------------------ */

describe('routeToHash', () => {
  it('returns / for list route', () => {
    expect(routeToHash({ view: 'list' })).toBe('/');
  });

  it('returns /workout/<id> for workout route', () => {
    expect(routeToHash({ view: 'workout', workoutId: 'squat-a' })).toBe(
      '/workout/squat-a',
    );
  });

  it('returns /import/<data> for a shared workout import route', () => {
    expect(routeToHash({ view: 'import', data: 'abc_123-XYZ' })).toBe(
      '/import/abc_123-XYZ',
    );
  });

  it('encodes special characters in workout ID', () => {
    expect(routeToHash({ view: 'workout', workoutId: 'my workout' })).toBe(
      '/workout/my%20workout',
    );
  });

  it('returns /calendar for calendar route', () => {
    expect(routeToHash({ view: 'calendar' })).toBe('/calendar');
  });

  it('returns /edit/new for editor route without workoutId', () => {
    expect(routeToHash({ view: 'editor' })).toBe('/edit/new');
  });

  it('returns /edit/<id> for editor route with workoutId', () => {
    expect(routeToHash({ view: 'editor', workoutId: 'workout-a' })).toBe(
      '/edit/workout-a',
    );
  });

  it('encodes special characters in editor workout ID', () => {
    expect(routeToHash({ view: 'editor', workoutId: 'my workout' })).toBe(
      '/edit/my%20workout',
    );
  });

  it('returns /exercises for exercises route', () => {
    expect(routeToHash({ view: 'exercises' })).toBe('/exercises');
  });

  it('returns /progress for progress route', () => {
    expect(routeToHash({ view: 'progress' })).toBe('/progress');
  });

  it('returns /settings for settings route', () => {
    expect(routeToHash({ view: 'settings' })).toBe('/settings');
  });

  it('returns /exercise/new for exercise editor route without exerciseId', () => {
    expect(routeToHash({ view: 'exerciseEditor' })).toBe('/exercise/new');
  });

  it('returns /exercise/<id> for exercise editor route with exerciseId', () => {
    expect(routeToHash({ view: 'exerciseEditor', exerciseId: 'bench' })).toBe(
      '/exercise/bench',
    );
  });

  it('encodes special characters in exercise editor ID', () => {
    expect(routeToHash({ view: 'exerciseEditor', exerciseId: 'my exercise' })).toBe(
      '/exercise/my%20exercise',
    );
  });

  it('round-trips through parseHash', () => {
    const routes: Route[] = [
      { view: 'list' },
      { view: 'workout', workoutId: 'bench-b' },
      { view: 'workout', workoutId: 'press-c' },
      { view: 'import', data: 'abc_123-XYZ' },
      { view: 'calendar' },
      { view: 'editor' },
      { view: 'editor', workoutId: 'workout-a' },
      { view: 'exercises' },
      { view: 'progress' },
      { view: 'settings' },
      { view: 'garmin' },
      { view: 'garmin-activities' },
      { view: 'wellness' },
      { view: 'withings' },
      { view: 'exerciseEditor' },
      { view: 'exerciseEditor', exerciseId: 'bench' },
    ];
    for (const route of routes) {
      const hash = '#' + routeToHash(route);
      expect(parseHash(hash)).toEqual(route);
    }
  });
});

describe('getSettingsRouteRedirect', () => {
  it('preserves settings-dependent routes while settings load', () => {
    const visibility = { showGarminTab: false, showCalendarTab: false };

    expect(getSettingsRouteRedirect({ view: 'calendar' }, false, visibility)).toBeNull();
    expect(getSettingsRouteRedirect({ view: 'garmin' }, false, visibility)).toBeNull();
    expect(getSettingsRouteRedirect({ view: 'garmin-activities' }, false, visibility)).toBeNull();
  });

  it('allows enabled routes after settings load', () => {
    const visibility = { showGarminTab: true, showCalendarTab: true };

    expect(getSettingsRouteRedirect({ view: 'calendar' }, true, visibility)).toBeNull();
    expect(getSettingsRouteRedirect({ view: 'garmin' }, true, visibility)).toBeNull();
    expect(getSettingsRouteRedirect({ view: 'garmin-activities' }, true, visibility)).toBeNull();
  });

  it('redirects disabled routes after settings load', () => {
    const visibility = { showGarminTab: false, showCalendarTab: false };

    expect(getSettingsRouteRedirect({ view: 'calendar' }, true, visibility)).toEqual({ view: 'list' });
    expect(getSettingsRouteRedirect({ view: 'garmin' }, true, visibility)).toEqual({ view: 'list' });
    expect(getSettingsRouteRedirect({ view: 'garmin-activities' }, true, visibility)).toEqual({ view: 'list' });
  });
});
