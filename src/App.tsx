import { useState, useCallback, useEffect, useRef } from 'react';
import type { Workout, LiftConfig, SetResult, ComputedSet, PreviousSetData, ProgressionProposal, DayFlags, DayFlagEntry, WorkoutScheduleEntry, CardioActivity, MealItem, MealLogEntry, AppSettings, AppBooleanSettingKey, AppPercentSettingKey } from './model/index.js';
import { computeProgression } from './model/index.js';
import { appendLogRows, buildLogRow, readLogZone, findPreviousWorkoutSets, writeConfigValues, writeDefaultConfig, verifyScheduleTab, createScheduleTab, readFlags, writeFlags, verifyWorkoutScheduleTab, createWorkoutScheduleTab, readWorkoutSchedule, writeWorkoutSchedule, writeWorkoutDefs, readWorkoutDefs, writeDefaultWorkoutDefs, updateLogRows, deleteLogSession, writeCardioActivities, readCardioActivities, writeDefaultCardioActivities, readMealItems, writeMealItems, readMealLog, appendMealLogEntry, deleteMealLogEntry, readGarminActivities, verifyGarminTab, readWithingsMeasurements, verifyWithingsTab, createWithingsTab, verifySettingsTab, createSettingsTab, readSettings, writeSettings, goalsFromSettings, goalsToSettings, bodyGoalsFromSettings, bodyGoalsToSettings, liftGoalsFromSettings, liftGoalsToSettings, DEFAULT_APP_SETTINGS, appSettingsFromMap, appSettingsToMap } from './google/index.js';
import type { LiftGoal } from './google/index.js';
import { syncScheduleWithCalendar, generateStrongerId, withAuthRetry, loadCalendarId, listEventsInRange, isStrongerEvent, getEventDate } from './google/index.js';
import type { CalendarSyncResult } from './google/index.js';
import type { WorkoutDefinition } from './data/sample-workouts.js';
import type { ParsedLogRow } from './google/index.js';
import { buildWorkoutsFromConfigs, workoutDefinitions, defaultCardioActivities } from './data/sample-workouts.js';
import { WorkoutSelect } from './components/WorkoutSelect.js';
import { WorkoutView } from './components/WorkoutView.js';
import { WorkoutEditor } from './components/WorkoutEditor.js';
import { ExerciseLibrary } from './components/ExerciseLibrary.js';
import { ExerciseEditor } from './components/ExerciseEditor.js';
import { ProgressionReview } from './components/ProgressionReview.js';
import { CalendarView, SessionDetail } from './components/CalendarView.js';
import type { LogSession } from './components/CalendarView.js';
import type { ClearOptions, ClearResult } from './components/CalendarClear.js';
import { ProgressView } from './components/ProgressView.js';
import { ActivitiesView } from './components/ActivitiesView.js';
import { SettingsView } from './components/SettingsView.js';
import { SetupPage } from './components/SetupPage.js';
import { GoogleAuth } from './components/GoogleAuth.js';
import { useHashRouter } from './hooks/useHashRouter.js';
import { loadDraft, saveDraft, clearDraft } from './hooks/useWorkoutDraft.js';
import { clearSentinel as clearTimerSentinel } from './hooks/useRestTimer.js';
import type { StravaActivity, StravaGoal, StravaMetric } from './model/strava.js';
import type { WithingsMeasurement } from './model/types.js';
import type { WithingsGoal, WithingsMetric } from './model/withings.js';
import { WithingsView } from './components/WithingsView.js';
import { NutritionView } from './components/NutritionView.js';
import './App.css';

function App() {
  const { route, navigateTo, replaceTo } = useHashRouter();
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [previousSets, setPreviousSets] = useState<PreviousSetData[][] | null>(null);
  const [sheetConnected, setSheetConnected] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [configs, setConfigs] = useState<LiftConfig[]>([]);
  const [definitions, setDefinitions] = useState<WorkoutDefinition[]>([]);
  const [progressionProposals, setProgressionProposals] = useState<ProgressionProposal[] | null>(null);
  const [workoutSchedule, setWorkoutSchedule] = useState<WorkoutScheduleEntry[]>([]);
  const [dayFlags, setDayFlags] = useState<DayFlagEntry[]>([]);
  const [logRows, setLogRows] = useState<ParsedLogRow[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [viewingSession, setViewingSession] = useState<LogSession | null>(null);
  const [cardioActivities, setCardioActivities] = useState<CardioActivity[]>([]);
  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [mealLog, setMealLog] = useState<MealLogEntry[]>([]);
  const [stravaGoals, setStravaGoals] = useState<StravaGoal[]>([]);
  const [garminActivities, setGarminActivities] = useState<StravaActivity[]>([]);
  const [withingsMeasurements, setWithingsMeasurements] = useState<WithingsMeasurement[]>([]);
  const [withingsGoals, setWithingsGoals] = useState<WithingsGoal[]>([]);
  const [liftGoals, setLiftGoals] = useState<LiftGoal[]>([]);
  const [draftResults, setDraftResults] = useState<SetResult[][] | null>(null);
  const [pendingFinish, setPendingFinish] = useState<{
    workout: Workout;
    results: SetResult[][];
    endTime: string;
  } | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const settingsRef = useRef(new Map<string, string>());

  // Lazy-loading flags: track whether secondary data has been fetched
  const flagsLoadedRef = useRef(false);
  const workoutScheduleLoadedRef = useRef(false);
  const logLoadedRef = useRef(false);
  const stravaLoadedRef = useRef(false);
  const garminLoadedRef = useRef(false);
  const withingsLoadedRef = useRef(false);
  const nutritionLoadedRef = useRef(false);

  const handleConnected = useCallback(
    (loadedWorkouts: Workout[], loadedConfigs: LiftConfig[], sheetId: string, defs: WorkoutDefinition[], cardio: CardioActivity[]) => {
      setWorkouts(loadedWorkouts);
      setConfigs(loadedConfigs);
      setDefinitions(defs);
      setSpreadsheetId(sheetId);
      setSheetConnected(true);
      setNeedsSetup(false);
      setCardioActivities(cardio);
      // Reset lazy-loading flags for new connection
      flagsLoadedRef.current = false;
      workoutScheduleLoadedRef.current = false;
      logLoadedRef.current = false;
      stravaLoadedRef.current = false;
      garminLoadedRef.current = false;
      withingsLoadedRef.current = false;
      nutritionLoadedRef.current = false;
    },
    [],
  );

  const handleNeedsSetup = useCallback((sheetId: string) => {
    setSpreadsheetId(sheetId);
    setSheetConnected(true);
    setNeedsSetup(true);
  }, []);

  const handleSetupConfirm = useCallback(
    async (configs: LiftConfig[]) => {
      if (!spreadsheetId) return;

      // Write the user's configs to the sheet (writeDefaultConfig writes
      // the header row too, which is needed for a fresh config zone).
      await writeDefaultConfig(spreadsheetId, configs);
      setConfigs(configs);

      // Read or write default workout definitions
      const liftNames = new Map(configs.map((c) => [c.id, c.name]));
      let defs = await readWorkoutDefs(spreadsheetId, liftNames);
      if (!defs) {
        await writeDefaultWorkoutDefs(spreadsheetId, workoutDefinitions);
        defs = workoutDefinitions;
      }
      setDefinitions(defs);

      // Read or seed default cardio activities
      let cardio = await readCardioActivities(spreadsheetId);
      if (!cardio) {
        await writeDefaultCardioActivities(spreadsheetId, defaultCardioActivities);
        cardio = [...defaultCardioActivities];
      }
      setCardioActivities(cardio);

      const builtWorkouts = buildWorkoutsFromConfigs(configs, defs);
      setWorkouts(builtWorkouts);
      setNeedsSetup(false);
    },
    [spreadsheetId],
  );

  const handleDisconnected = useCallback(() => {
    setSheetConnected(false);
    setActiveWorkout(null);
    setPreviousSets(null);
    setWorkouts([]);
    setConfigs([]);
    setDefinitions([]);
    setSpreadsheetId(null);
    setStartTime(null);
    setProgressionProposals(null);
    setWorkoutSchedule([]);
    setDayFlags([]);
    setLogRows([]);
    setNeedsSetup(false);
    setCardioActivities([]);
    setGarminActivities([]);
    setWithingsMeasurements([]);
    setWithingsGoals([]);
    setMealItems([]);
    setMealLog([]);
    // Reset lazy-loading flags
    flagsLoadedRef.current = false;
    workoutScheduleLoadedRef.current = false;
    logLoadedRef.current = false;
    stravaLoadedRef.current = false;
    garminLoadedRef.current = false;
    withingsLoadedRef.current = false;
    nutritionLoadedRef.current = false;
    replaceTo({ view: 'list' });
  }, [replaceTo]);

  const loadPreviousSets = useCallback(
    async (sheetId: string, workoutId: string) => {
      try {
        // If log data is already loaded, use it directly
        if (logLoadedRef.current && logRows.length > 0) {
          const prev = findPreviousWorkoutSets(logRows, workoutId);
          setPreviousSets(prev);
          return;
        }
        // Otherwise fetch from sheet
        await withAuthRetry(async () => {
          const rows = await readLogZone(sheetId);
          setLogRows(rows);
          logLoadedRef.current = true;
          const prev = findPreviousWorkoutSets(rows, workoutId);
          setPreviousSets(prev);
        });
      } catch {
        // Silently ignore — previous data is optional context
      }
    },
    [logRows],
  );

  const handleSelectWorkout = useCallback((workout: Workout) => {
    // Check for an existing in-progress draft for this workout
    const draft = loadDraft();
    if (draft && draft.workoutId === workout.id) {
      // Resume the previous session
      setStartTime(draft.startTime);
      setDraftResults(draft.results.length > 0 ? draft.results : null);
    } else {
      // Start a fresh session
      const now = new Date().toISOString();
      setStartTime(now);
      setDraftResults(null);
      // Persist the draft so a refresh can restore the active workout
      saveDraft({ workoutId: workout.id, startTime: now, results: [] });
    }
    setActiveWorkout(workout);
    setPreviousSets(null);
    navigateTo({ view: 'workout', workoutId: workout.id });
    // Fire-and-forget: load previous workout data for context
    if (spreadsheetId) {
      void loadPreviousSets(spreadsheetId, workout.id);
    }
  }, [spreadsheetId, loadPreviousSets, navigateTo]);

  const handleFinish = useCallback(
    (workout: Workout, results: SetResult[][]) => {
      const endTime = new Date().toISOString();

      // Store pending finish data — workout will be saved when user confirms
      setPendingFinish({ workout, results, endTime });

      // Compute progression proposals for the completed workout
      const workoutDef = definitions.find((d) => d.id === workout.id);
      if (workoutDef && configs.length > 0) {
        const proposals = computeProgression(
          workout.exercises,
          results,
          configs,
          workoutDef.templates,
        );
        setProgressionProposals(proposals);
      } else {
        // Even with no proposals, show the confirm page
        setProgressionProposals([]);
      }
    },
    [configs, definitions],
  );

  const handleProgressionConfirm = useCallback(
    (updates: Map<string, { topSetWeight: number; backoffWeight: number }>) => {
      // Clear the in-progress draft and rest timer now that the workout is finalized
      clearDraft();
      clearTimerSentinel();

      // Save the pending workout results to the sheet
      if (pendingFinish && spreadsheetId && startTime) {
        const { workout, results, endTime } = pendingFinish;
        const sid = spreadsheetId;
        void logWorkoutResults(
          sid,
          workout,
          results,
          startTime,
          endTime,
        ).then(() => {
          void loadLogData(sid);
        });
      }

      // Apply weight updates to configs
      const updatedConfigs = configs.map((c) => {
        const update = updates.get(c.id);
        if (!update) return c;
        return { ...c, topSetWeight: update.topSetWeight, backoffWeight: update.backoffWeight };
      });

      // Write updated configs back to the sheet
      if (spreadsheetId) {
        void withAuthRetry(() => writeConfigValues(spreadsheetId, updatedConfigs));
      }

      // Update local state so the next workout uses the new weights
      setConfigs(updatedConfigs);
      setWorkouts(buildWorkoutsFromConfigs(updatedConfigs, definitions));
      setProgressionProposals(null);
      setPendingFinish(null);
      setActiveWorkout(null);
      setStartTime(null);
      setPreviousSets(null);
      navigateTo({ view: 'list' });
    },
    [spreadsheetId, startTime, pendingFinish, configs, definitions, navigateTo],
  );

  const handleProgressionBack = useCallback(() => {
    // Return to the active workout — discard pending finish and proposals
    setProgressionProposals(null);
    setPendingFinish(null);
  }, []);

  const handleBack = useCallback(() => {
    // Don't clear the draft or timer sentinel — the user may return to this
    // workout later and expects to resume where they left off.
    setActiveWorkout(null);
    setStartTime(null);
    setPreviousSets(null);
    setDraftResults(null);
    navigateTo({ view: 'list' });
  }, [navigateTo]);

  // Schedule handlers
  const loadFlagsData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const flagsTabExists = await verifyScheduleTab(sheetId);
        if (!flagsTabExists) {
          await createScheduleTab(sheetId);
        }
        const flags = await readFlags(sheetId);
        setDayFlags(flags);
      });
    } catch {
      // Silently ignore — flags data is optional
    }
  }, []);

  const loadWorkoutScheduleData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const wsTabExists = await verifyWorkoutScheduleTab(sheetId);
        if (!wsTabExists) {
          await createWorkoutScheduleTab(sheetId);
        }
        const schedule = await readWorkoutSchedule(sheetId);
        setWorkoutSchedule(schedule);
      });
    } catch {
      // Silently ignore — schedule data is optional
    }
  }, []);

  const loadLogData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const rows = await readLogZone(sheetId);
        setLogRows(rows);
        logLoadedRef.current = true;
      });
    } catch {
      // Silently ignore — log data is optional for calendar history
    }
  }, []);

  const loadStravaData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const settingsTabExists = await verifySettingsTab(sheetId);
        if (!settingsTabExists) {
          await createSettingsTab(sheetId);
        }
        const settings = await readSettings(sheetId);
        settingsRef.current = settings;
        setStravaGoals(goalsFromSettings(settings));
        setWithingsGoals(bodyGoalsFromSettings(settings));
        setLiftGoals(liftGoalsFromSettings(settings));
        setAppSettings(appSettingsFromMap(settings));
      });
    } catch {
      // Silently ignore — settings data is optional
    }
  }, []);

  const loadGarminData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const tabExists = await verifyGarminTab(sheetId);
        if (!tabExists) {
          // The Garmin tab is created by the sync script, not the app.
          setGarminActivities([]);
          return;
        }
        const activities = await readGarminActivities(sheetId);
        setGarminActivities(activities);
      });
    } catch {
      // Silently ignore — Garmin data is optional
    }
  }, []);

  const loadWithingsData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const tabExists = await verifyWithingsTab(sheetId);
        if (!tabExists) {
          await createWithingsTab(sheetId);
        }
        const measurements = await readWithingsMeasurements(sheetId);
        setWithingsMeasurements(measurements);
      });
    } catch {
      // Silently ignore — Withings data is optional
    }
  }, []);

  const loadNutritionData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const [items, entries] = await Promise.all([readMealItems(sheetId), readMealLog(sheetId)]);
        setMealItems(items);
        setMealLog(entries);
      });
    } catch {
      // Nutrition is optional if the sheet cannot be read.
    }
  }, []);

  const handleScheduleAssign = useCallback(
    (date: string, workoutId: string) => {
      const updated = [...workoutSchedule, { date, workoutId, strongerId: generateStrongerId() }];
      setWorkoutSchedule(updated);
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutSchedule(spreadsheetId, updated));
      }
    },
    [workoutSchedule, spreadsheetId],
  );

  const handleBulkSchedule = useCallback(
    (entries: WorkoutScheduleEntry[]) => {
      // Separate rest signals from actual additions
      const datesToRest = new Set(
        entries.filter((e) => e.workoutId === '__rest__').map((e) => e.date),
      );
      const toAdd = entries.filter((e) => e.workoutId !== '__rest__');

      // For rest dates: blank out workoutIds instead of deleting rows
      // (preserves calendarEventIds and strongerIds for sync cleanup)
      let updated = workoutSchedule.map((e) => {
        if (datesToRest.has(e.date) && e.workoutId) {
          return { ...e, workoutId: '' };
        }
        return e;
      });

      // Add new entries with strongerIds, deduplicating (skip if same date+workoutId already exists)
      for (const entry of toAdd) {
        const exists = updated.some(
          (e) => e.date === entry.date && e.workoutId === entry.workoutId,
        );
        if (!exists) {
          updated.push({ ...entry, strongerId: entry.strongerId ?? generateStrongerId() });
        }
      }

      setWorkoutSchedule(updated);
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutSchedule(spreadsheetId, updated));
      }
    },
    [workoutSchedule, spreadsheetId],
  );

  const handleScheduleRemove = useCallback(
    (date: string, workoutId: string) => {
      // Blank out the workoutId instead of deleting the row.
      // This preserves calendarEventId and strongerId for calendar sync cleanup.
      let blanked = false;
      const updated = workoutSchedule.map((e) => {
        if (!blanked && e.date === date && e.workoutId === workoutId) {
          blanked = true;
          return { ...e, workoutId: '' };
        }
        return e;
      });
      setWorkoutSchedule(updated);
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutSchedule(spreadsheetId, updated));
      }
    },
    [workoutSchedule, spreadsheetId],
  );

  const handleUpdateFlags = useCallback(
    (date: string, flags: DayFlags) => {
      const hasFlags = flags.home || flags.elsewhere || flags.travel || flags.visitors || flags.alcohol || flags.blocked;
      const flagIdx = dayFlags.findIndex((e) => e.date === date);
      let updated: DayFlagEntry[];
      if (flagIdx >= 0) {
        if (hasFlags) {
          updated = dayFlags.map((e, i) =>
            i === flagIdx ? { ...e, flags } : e,
          );
        } else {
          // Remove the flag entry entirely (no flags left)
          updated = dayFlags.filter((_, i) => i !== flagIdx);
        }
      } else if (hasFlags) {
        updated = [...dayFlags, { date, flags }];
      } else {
        return; // Nothing to do
      }
      setDayFlags(updated);
      if (spreadsheetId) {
        void withAuthRetry(() => writeFlags(spreadsheetId, updated));
      }
    },
    [dayFlags, spreadsheetId],
  );

  const handleCalendarOpenWorkout = useCallback(
    (workoutId: string) => {
      const match = workouts.find((w) => w.id === workoutId);
      if (match) {
        handleSelectWorkout(match);
      }
    },
    [workouts, handleSelectWorkout],
  );

  const handleSyncCalendar = useCallback(
    async (calendarId: string): Promise<CalendarSyncResult> => {
      const resolveWorkoutName = (workoutId: string): string | null => {
        if (workoutId.startsWith('cardio:')) {
          const cardioId = workoutId.slice('cardio:'.length);
          const c = cardioActivities.find((a) => a.id === cardioId);
          return c?.name ?? null;
        }
        const w = workouts.find((wk) => wk.id === workoutId);
        return w?.name ?? null;
      };

      const resolveWorkoutId = (name: string): string | null => {
        // Try strength workouts first
        const w = workouts.find((wk) => wk.name === name);
        if (w) return w.id;
        // Try cardio activities
        const c = cardioActivities.find((a) => a.name === name);
        if (c) return `cardio:${c.id}`;
        return null;
      };

      const { updatedSchedule, result } = await withAuthRetry(() => syncScheduleWithCalendar(
        calendarId,
        workoutSchedule,
        resolveWorkoutName,
        resolveWorkoutId,
      ));

      setWorkoutSchedule(updatedSchedule);
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutSchedule(spreadsheetId, updatedSchedule));
      }
      return result;
    },
    [workoutSchedule, workouts, cardioActivities, spreadsheetId],
  );

  const handleClearSchedule = useCallback(
    async (options: ClearOptions): Promise<ClearResult> => {
      const { startDate, weeks, clearFlags: shouldClearFlags, clearSchedule: shouldClearSchedule } = options;
      const result: ClearResult = { flagsCleared: 0, scheduleCleared: 0, calendarEventsDeleted: 0, errors: [] };

      // Compute date range
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const start = new Date(sy, sm - 1, sd);
      const dateSet = new Set<string>();
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dateSet.add(dateStr);
      }
      // End date for calendar API queries (one day past the range)
      const rangeEnd = new Date(sy, sm - 1, sd + weeks * 7);
      const endDate = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, '0')}-${String(rangeEnd.getDate()).padStart(2, '0')}`;

      // Clear flags
      if (shouldClearFlags) {
        const before = dayFlags.length;
        const updatedFlags = dayFlags.filter((e) => !dateSet.has(e.date));
        result.flagsCleared = before - updatedFlags.length;
        setDayFlags(updatedFlags);
        if (spreadsheetId) {
          try {
            await withAuthRetry(() => writeFlags(spreadsheetId, updatedFlags));
          } catch (err) {
            result.errors.push(`Failed to write flags: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Clear workout schedule
      if (shouldClearSchedule) {
        // Collect entries in the date range that have workoutIds
        const entriesToClear = workoutSchedule.filter((e) => dateSet.has(e.date) && e.workoutId);
        result.scheduleCleared = entriesToClear.length;

        // Blank out workoutIds (preserves calendarEventId/strongerId for cleanup)
        const updatedSchedule = workoutSchedule.map((e) => {
          if (dateSet.has(e.date) && e.workoutId) {
            return { ...e, workoutId: '' };
          }
          return e;
        });

        // Try to delete Google Calendar events for cleared entries
        const calendarId = loadCalendarId();
        if (calendarId) {
          const gapi = window.gapi;
          if (gapi) {
            // Delete events we have direct references to
            const deletedEventIds = new Set<string>();
            for (const entry of entriesToClear) {
              if (entry.calendarEventId) {
                try {
                  await gapi.client.calendar.events.delete({
                    calendarId,
                    eventId: entry.calendarEventId,
                  });
                  deletedEventIds.add(entry.calendarEventId);
                  result.calendarEventsDeleted++;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  result.errors.push(`Delete event ${entry.calendarEventId}: ${msg}`);
                }
              }
            }

            // Also delete orphaned Stronger events in the date range that have
            // no schedule entry (e.g., pushed from Planner without sync)
            try {
              const allEvents = await listEventsInRange(calendarId, startDate, endDate);
              for (const calEvent of allEvents) {
                if (!calEvent.id || deletedEventIds.has(calEvent.id)) continue;
                if (calEvent.status === 'cancelled') continue;
                const eventDate = getEventDate(calEvent);
                if (!eventDate || !dateSet.has(eventDate)) continue;
                if (!isStrongerEvent(calEvent)) continue;
                try {
                  await gapi.client.calendar.events.delete({
                    calendarId,
                    eventId: calEvent.id,
                  });
                  result.calendarEventsDeleted++;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  result.errors.push(`Delete orphaned event ${calEvent.id}: ${msg}`);
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(`Failed to list calendar events for orphan cleanup: ${msg}`);
            }
          }
        }

        // After deleting calendar events, remove entries that no longer serve a purpose
        // (those with no workoutId and whose calendar events were deleted or had none)
        const finalSchedule = updatedSchedule.filter((e) => {
          if (!dateSet.has(e.date)) return true; // keep entries outside range
          if (e.workoutId) return true; // keep entries with workoutIds
          // In range + blanked: only keep if calendarEventId and we didn't delete it
          if (e.calendarEventId && !calendarId) return true; // keep for future sync
          return false;
        });

        setWorkoutSchedule(finalSchedule);
        if (spreadsheetId) {
          try {
            await withAuthRetry(() => writeWorkoutSchedule(spreadsheetId, finalSchedule));
          } catch (err) {
            result.errors.push(`Failed to write schedule: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return result;
    },
    [workoutSchedule, dayFlags, spreadsheetId],
  );

  const handleUpdateLogRows = useCallback(
    (sessionDate: string, sessionWorkoutId: string, sessionStartTime: string, updatedRows: ParsedLogRow[]) => {
      // Update local state
      setLogRows((prev) => {
        const next = [...prev];
        for (const updated of updatedRows) {
          const idx = next.findIndex(
            (r) =>
              r.date === sessionDate &&
              r.workoutId === sessionWorkoutId &&
              r.startTime === sessionStartTime &&
              r.exerciseName === updated.exerciseName &&
              r.setNumber === updated.setNumber,
          );
          if (idx >= 0) {
            next[idx] = updated;
          }
        }
        return next;
      });
      // Fire-and-forget: write to sheet
      if (spreadsheetId) {
        void withAuthRetry(() => updateLogRows(spreadsheetId, sessionDate, sessionWorkoutId, sessionStartTime, updatedRows));
      }
    },
    [spreadsheetId],
  );

  const handleDeleteSession = useCallback(
    (sessionDate: string, sessionWorkoutId: string, sessionStartTime: string) => {
      // Remove matching rows from local state
      setLogRows((prev) =>
        prev.filter(
          (r) =>
            !(r.date === sessionDate && r.workoutId === sessionWorkoutId && r.startTime === sessionStartTime),
        ),
      );
      // Fire-and-forget: delete from sheet
      if (spreadsheetId) {
        void withAuthRetry(() => deleteLogSession(spreadsheetId, sessionDate, sessionWorkoutId, sessionStartTime));
      }
    },
    [spreadsheetId],
  );

  const handleViewSession = useCallback((session: LogSession) => {
    setViewingSession(session);
  }, []);

  const handleViewSessionSave = useCallback(
    (updatedRows: ParsedLogRow[]) => {
      if (!viewingSession) return;
      const { date, workoutId, startTime } = viewingSession.key;
      handleUpdateLogRows(date, workoutId, startTime, updatedRows);
    },
    [viewingSession, handleUpdateLogRows],
  );

  const handleViewSessionClose = useCallback(() => {
    setViewingSession(null);
  }, []);

  const handleGoToList = useCallback(() => {
    navigateTo({ view: 'list' });
  }, [navigateTo]);

  const handleOpenCalendar = useCallback(() => {
    navigateTo({ view: 'calendar' });
  }, [navigateTo]);

  const handleOpenExercises = useCallback(() => {
    navigateTo({ view: 'exercises' });
  }, [navigateTo]);

  const handleOpenProgress = useCallback(() => {
    navigateTo({ view: 'progress' });
  }, [navigateTo]);

  const handleOpenSettings = useCallback(() => {
    navigateTo({ view: 'settings' });
  }, [navigateTo]);

  const handleOpenGarmin = useCallback(() => {
    navigateTo({ view: 'garmin' });
  }, [navigateTo]);

  const handleOpenWithings = useCallback(() => {
    navigateTo({ view: 'withings' });
  }, [navigateTo]);

  const handleOpenNutrition = useCallback(() => {
    navigateTo({ view: 'nutrition' });
  }, [navigateTo]);

  const handleSaveMealItems = useCallback((items: MealItem[]) => {
    setMealItems(items);
    if (spreadsheetId) void withAuthRetry(() => writeMealItems(spreadsheetId, items));
  }, [spreadsheetId]);

  const handleLogMealEntry = useCallback((entry: MealLogEntry) => {
    setMealLog((previous) => [...previous, entry]);
    if (spreadsheetId) void withAuthRetry(() => appendMealLogEntry(spreadsheetId, entry));
  }, [spreadsheetId]);

  const handleDeleteMealEntry = useCallback((id: string) => {
    setMealLog((previous) => previous.filter((entry) => entry.id !== id));
    if (spreadsheetId) void withAuthRetry(() => deleteMealLogEntry(spreadsheetId, id));
  }, [spreadsheetId]);

  const handleWithingsGoalChange = useCallback((metric: WithingsMetric, value: number | null) => {
    setWithingsGoals((prev) => {
      const updated = prev.filter((g) => g.metric !== metric);
      if (value !== null) {
        updated.push({ metric, value });
      }
      if (spreadsheetId) {
        bodyGoalsToSettings(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleStravaGoalChange = useCallback((metric: StravaMetric, value: number | null) => {
    setStravaGoals((prev) => {
      const updated = prev.filter((g) => g.metric !== metric);
      if (value !== null) {
        updated.push({ metric, value });
      }
      if (spreadsheetId) {
        // Merge goals into settings and write the full settings map
        goalsToSettings(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleLiftGoalChange = useCallback((liftId: string, weight: number | null) => {
    setLiftGoals((prev) => {
      const updated = prev.filter((g) => g.liftId !== liftId);
      if (weight !== null) {
        updated.push({ liftId, weight });
      }
      if (spreadsheetId) {
        liftGoalsToSettings(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleAppSettingChange = useCallback((key: AppBooleanSettingKey, value: boolean) => {
    setAppSettings((prev) => {
      const updated = { ...prev, [key]: value };
      if (spreadsheetId) {
        appSettingsToMap(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleAppPercentSettingChange = useCallback((key: AppPercentSettingKey, value: number) => {
    setAppSettings((prev) => {
      const updated = { ...prev, [key]: value };
      if (spreadsheetId) {
        appSettingsToMap(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleImportComplete = useCallback(() => {
    // Refresh log data so progress charts and calendar history reflect the import
    if (spreadsheetId) {
      void loadLogData(spreadsheetId);
    }
  }, [spreadsheetId]);

  // Editor handlers
  const handleEditWorkout = useCallback((workoutId: string) => {
    navigateTo({ view: 'editor', workoutId });
  }, [navigateTo]);

  const handleNewWorkout = useCallback(() => {
    navigateTo({ view: 'editor' });
  }, [navigateTo]);

  const handleDuplicateWorkout = useCallback(
    (workoutId: string) => {
      const source = definitions.find((d) => d.id === workoutId);
      if (!source) return;
      const newId = generateStrongerId();
      const newDef = { ...source, id: newId, name: `${source.name} (Copy)`, favorite: false };
      const updatedDefs = [...definitions, newDef];
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs));
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }
      navigateTo({ view: 'editor', workoutId: newId });
    },
    [definitions, configs, spreadsheetId, navigateTo],
  );

  const handleDeleteWorkoutFromList = useCallback(
    (workoutId: string) => {
      if (!confirm('Delete this workout?')) return;
      const updatedDefs = definitions.filter((d) => d.id !== workoutId);
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs));
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }
    },
    [definitions, configs, spreadsheetId],
  );

  const handleToggleFavorite = useCallback(
    (workoutId: string, favorite: boolean) => {
      const updatedDefs = definitions.map((d) =>
        d.id === workoutId ? { ...d, favorite } : d,
      );
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs));
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }
    },
    [definitions, configs, spreadsheetId],
  );

  const handleCardioSave = useCallback(
    (updated: CardioActivity[]) => {
      setCardioActivities(updated);
      if (spreadsheetId) {
        void withAuthRetry(() => writeCardioActivities(spreadsheetId, updated));
      }
    },
    [spreadsheetId],
  );

  const handleEditorCancel = useCallback(() => {
    navigateTo({ view: 'list' });
  }, [navigateTo]);

  const handleDeleteWorkout = useCallback(
    (workoutId: string) => {
      const updatedDefs = definitions.filter((d) => d.id !== workoutId);
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs));
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }
      navigateTo({ view: 'list' });
    },
    [definitions, configs, spreadsheetId, navigateTo],
  );

  // Exercise editor handlers
  const handleEditExercise = useCallback((exerciseId: string) => {
    navigateTo({ view: 'exerciseEditor', exerciseId });
  }, [navigateTo]);

  const handleNewExercise = useCallback(() => {
    navigateTo({ view: 'exerciseEditor' });
  }, [navigateTo]);

  const handleExerciseEditorCancel = useCallback(() => {
    navigateTo({ view: 'exercises' });
  }, [navigateTo]);

  const handleExerciseSave = useCallback(
    (config: LiftConfig) => {
      const isNew = !configs.some((c) => c.id === config.id);
      const updatedConfigs = isNew
        ? [...configs, config]
        : configs.map((c) => (c.id === config.id ? config : c));

      setConfigs(updatedConfigs);
      setWorkouts(buildWorkoutsFromConfigs(updatedConfigs, definitions));

      if (spreadsheetId) {
        void withAuthRetry(() => writeConfigValues(spreadsheetId, updatedConfigs));
      }

      navigateTo({ view: 'exercises' });
    },
    [configs, definitions, spreadsheetId, navigateTo],
  );

  const handleEditorSave = useCallback(
    (definition: WorkoutDefinition) => {
      const isNew = !definitions.some((d) => d.id === definition.id);
      const updatedDefs = isNew
        ? [...definitions, definition]
        : definitions.map((d) => (d.id === definition.id ? definition : d));

      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs));

      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }

      navigateTo({ view: 'list' });
    },
    [definitions, configs, spreadsheetId, navigateTo],
  );

  // Deep-link resolution: when auth completes and workouts are loaded,
  // check if the URL contains a workout ID and auto-select it.
  // If a draft exists in localStorage for this workout, restore startTime
  // and set results so the user doesn't lose progress after a refresh.
  useEffect(() => {
    if (!sheetConnected || workouts.length === 0) return;
    if (route.view !== 'workout') return;
    // Already showing the right workout — nothing to do
    if (activeWorkout?.id === route.workoutId) return;

    const match = workouts.find((w) => w.id === route.workoutId);
    if (match) {
      // Check for a saved draft from a previous session (page refresh)
      const draft = loadDraft();
      if (draft && draft.workoutId === match.id) {
        setStartTime(draft.startTime);
        setDraftResults(draft.results.length > 0 ? draft.results : null);
      } else {
        setStartTime(new Date().toISOString());
        setDraftResults(null);
      }
      setActiveWorkout(match);
      setPreviousSets(null);
      if (spreadsheetId) {
        void loadPreviousSets(spreadsheetId, match.id);
      }
    } else {
      // Invalid workout ID — redirect to list
      replaceTo({ view: 'list' });
    }
  }, [sheetConnected, workouts, route, activeWorkout?.id, spreadsheetId, loadPreviousSets, replaceTo]);

  // Sync state when the user presses the browser back button:
  // if the URL changed to list while a workout is active, clear React state
  // but preserve the localStorage draft/timer so the user can resume later.
  useEffect(() => {
    if (route.view === 'list' && activeWorkout && !progressionProposals) {
      setActiveWorkout(null);
      setStartTime(null);
      setPreviousSets(null);
      setDraftResults(null);
    }
  }, [route, activeWorkout, progressionProposals]);

  // Load workout schedule on home (list) or calendar view
  useEffect(() => {
    if ((route.view === 'list' || route.view === 'calendar') && spreadsheetId && !workoutScheduleLoadedRef.current) {
      workoutScheduleLoadedRef.current = true;
      void loadWorkoutScheduleData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadWorkoutScheduleData]);

  // Load day flags when calendar view is first visited
  useEffect(() => {
    if (route.view === 'calendar' && spreadsheetId && !flagsLoadedRef.current) {
      flagsLoadedRef.current = true;
      void loadFlagsData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadFlagsData]);

  // Lazy-load log data when calendar or progress view is first visited
  useEffect(() => {
    if ((route.view === 'calendar' || route.view === 'progress') && spreadsheetId && !logLoadedRef.current) {
      logLoadedRef.current = true;
      void loadLogData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadLogData]);

  // Lazy-load settings when garmin, progress, or settings view is first visited
  useEffect(() => {
    if ((route.view === 'garmin' || route.view === 'progress' || route.view === 'settings') && spreadsheetId && !stravaLoadedRef.current) {
      stravaLoadedRef.current = true;
      void loadStravaData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadStravaData]);

  // Lazy-load Garmin activities when the garmin view is first visited.
  useEffect(() => {
    if (route.view === 'garmin' && spreadsheetId && !garminLoadedRef.current) {
      garminLoadedRef.current = true;
      void loadGarminData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadGarminData]);

  // Lazy-load Withings measurements when the withings view is first visited.
  // (Body-composition goals arrive via the settings read in loadStravaData.)
  useEffect(() => {
    if (route.view === 'withings' && spreadsheetId && !withingsLoadedRef.current) {
      withingsLoadedRef.current = true;
      void loadWithingsData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadWithingsData]);

  useEffect(() => {
    if (route.view === 'nutrition' && spreadsheetId && !nutritionLoadedRef.current) {
      nutritionLoadedRef.current = true;
      void loadNutritionData(spreadsheetId);
    }
  }, [route.view, spreadsheetId, loadNutritionData]);

  // Gate: require auth + sheet connection before showing workouts
  if (!sheetConnected) {
    return (
      <GoogleAuth
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onNeedsSetup={handleNeedsSetup}
      />
    );
  }

  // Show setup page for first-time users (empty config zone)
  if (needsSetup) {
    return (
      <SetupPage
        onConfirm={handleSetupConfirm}
      />
    );
  }

  const onOpenGarmin = handleOpenGarmin;
  const onOpenWithings = handleOpenWithings;

  // Show progression review / confirm page after clicking Finish
  if (progressionProposals && pendingFinish) {
    const totalSets = pendingFinish.results.flat().length;
    const completedSets = pendingFinish.results.flat().filter((s) => s.completed).length;
    return (
      <ProgressionReview
        proposals={progressionProposals}
        completedSets={completedSets}
        totalSets={totalSets}
        onConfirm={handleProgressionConfirm}
        onBack={handleProgressionBack}
      />
    );
  }

  if (activeWorkout) {
    return (
      <WorkoutView
        workout={activeWorkout}
        previousSets={previousSets}
        startTime={startTime ?? new Date().toISOString()}
        draftResults={draftResults}
        appSettings={appSettings}
        configs={configs}
        onBack={handleBack}
        onFinish={handleFinish}
      />
    );
  }

  if (route.view === 'exerciseEditor') {
    const editConfig = route.exerciseId
      ? configs.find((c) => c.id === route.exerciseId)
      : undefined;
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <ExerciseEditor
          existing={editConfig}
          allConfigs={configs}
          onSave={handleExerciseSave}
          onCancel={handleExerciseEditorCancel}
        />
      </>
    );
  }

  if (route.view === 'exercises') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <ExerciseLibrary
          configs={configs}
          onEdit={handleEditExercise}
          onNew={handleNewExercise}
        />
      </>
    );
  }

  if (route.view === 'editor') {
    const editDef = route.workoutId
      ? definitions.find((d) => d.id === route.workoutId)
      : undefined;
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <WorkoutEditor
          existing={editDef}
          allDefinitions={definitions}
          configs={configs}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
          onDelete={editDef ? handleDeleteWorkout : undefined}
        />
      </>
    );
  }

  if (route.view === 'calendar') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <CalendarView
          workouts={workouts}
          cardioActivities={cardioActivities}
          workoutSchedule={workoutSchedule}
          dayFlags={dayFlags}
          logRows={logRows}
          onAssign={handleScheduleAssign}
          onRemove={handleScheduleRemove}
          onOpenWorkout={handleCalendarOpenWorkout}
          onUpdateLogRows={handleUpdateLogRows}
          onDeleteSession={handleDeleteSession}
          onBulkSchedule={handleBulkSchedule}
          onUpdateFlags={handleUpdateFlags}
          onSyncCalendar={handleSyncCalendar}
          onClearSchedule={handleClearSchedule}
        />
      </>
    );
  }

  if (route.view === 'progress') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <ProgressView
          logRows={logRows}
          liftGoals={liftGoals}
          onLiftGoalChange={handleLiftGoalChange}
          dipThresholdPercent={appSettings.progressDipThresholdPercent}
        />
      </>
    );
  }

  if (route.view === 'garmin') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <ActivitiesView
          activities={garminActivities}
          goals={stravaGoals}
          onGoalChange={handleStravaGoalChange}
          emptyText="No Garmin data yet. Run the Garmin sync to populate the 'Stronger - Garmin' tab."
        />
      </>
    );
  }

  if (route.view === 'withings') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <WithingsView
          measurements={withingsMeasurements}
          goals={withingsGoals}
          dipThresholdPercent={appSettings.withingsDipThresholdPercent}
          onGoalChange={handleWithingsGoalChange}
        />
      </>
    );
  }

  if (route.view === 'nutrition') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <NutritionView
          items={mealItems}
          entries={mealLog}
          onSaveItems={handleSaveMealItems}
          onLogEntry={handleLogMealEntry}
          onDeleteEntry={handleDeleteMealEntry}
        />
      </>
    );
  }

  if (route.view === 'settings' && spreadsheetId) {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <SettingsView
          spreadsheetId={spreadsheetId}
          onImportComplete={handleImportComplete}
          appendLogRows={appendLogRows}
          onDisconnectSheet={handleDisconnected}
          appSettings={appSettings}
          onAppSettingChange={handleAppSettingChange}
          onAppPercentSettingChange={handleAppPercentSettingChange}
        />
      </>
    );
  }

  // Compute missing liftIds: referenced in definitions but absent from configs
  const configIds = new Set(configs.map((c) => c.id));
  const missingLiftIds = [...new Set(
    definitions.flatMap((d) => d.templates.map((t) => t.liftId))
  )].filter((id) => !configIds.has(id));

  // Build workout names map for SessionDetail
  const workoutNames = new Map<string, string>(workouts.map((w) => [w.id, w.name]));

  if (viewingSession) {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={handleOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWithings={onOpenWithings}
          onOpenNutrition={handleOpenNutrition}
          onOpenSettings={handleOpenSettings}
        />
        <SessionDetail
          session={viewingSession}
          workoutNames={workoutNames}
          onSave={handleViewSessionSave}
          onClose={handleViewSessionClose}
        />
      </>
    );
  }

  return (
    <>
      <GoogleAuth
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onGoToList={handleGoToList}
        onOpenCalendar={handleOpenCalendar}
        onOpenExercises={handleOpenExercises}
        onOpenProgress={handleOpenProgress}
        onOpenGarmin={onOpenGarmin}
        onOpenWithings={onOpenWithings}
        onOpenNutrition={handleOpenNutrition}
        onOpenSettings={handleOpenSettings}
      />
      <WorkoutSelect
        workouts={workouts}
        missingLiftIds={missingLiftIds}
        workoutSchedule={workoutSchedule}
        logRows={logRows}
        onSelect={handleSelectWorkout}
        onViewSession={handleViewSession}
        onEdit={handleEditWorkout}
        onDuplicate={handleDuplicateWorkout}
        onDelete={handleDeleteWorkoutFromList}
        onNew={handleNewWorkout}
        onToggleFavorite={handleToggleFavorite}
        cardioActivities={cardioActivities}
        onCardioSave={handleCardioSave}
      />
    </>
  );
}

export default App;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function logWorkoutResults(
  sheetId: string,
  workout: Workout,
  results: SetResult[][],
  startTime: string,
  endTime: string,
): Promise<void> {
  const now = new Date(endTime);
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const ctx = { date, startTime, endTime, workoutId: workout.id };

  const rows: (string | number | boolean)[][] = [];
  for (let ei = 0; ei < workout.exercises.length; ei++) {
    const exercise = workout.exercises[ei];
    for (let si = 0; si < results[ei].length; si++) {
      const planned: ComputedSet =
        si < exercise.sets.length
          ? exercise.sets[si]
          : {
              setType: results[ei][si].actualSetType,
              weight: results[ei][si].actualWeight,
              minReps: results[ei][si].actualReps,
              maxReps: results[ei][si].actualReps,
              amrap: false,
            };
      rows.push(
        buildLogRow(
          ctx,
          exercise.name,
          exercise.liftId,
          si + 1,
          results[ei][si].actualSetType,
          planned,
          results[ei][si],
        ),
      );
    }
  }

  await withAuthRetry(() => appendLogRows(sheetId, rows));
}
