import { useState, useCallback, useEffect, useRef } from 'react';
import type { Workout, LiftConfig, SetResult, ComputedSet, PreviousSetData, ProgressionProposal, DayFlags, DayFlagEntry, WorkoutScheduleEntry, CardioActivity, AppSettings, AppBooleanSettingKey, AppNumericSettingKey, GarminWellnessEntry } from './model/index.js';
import { computeProgression, REST_ID } from './model/index.js';
import { buildLogRow, findPreviousWorkoutSets, goalsFromSettings, goalsToSettings, bodyGoalsFromSettings, bodyGoalsToSettings, liftGoalsFromSettings, liftGoalsToSettings, DEFAULT_APP_SETTINGS, appSettingsFromMap, appSettingsToMap } from './google/index.js';
import { appendLogRows, ensureUser, readConfigZone, readLogZone, writeConfigValues, writeDefaultConfig, readFlags, writeFlagDates, readWorkoutSchedule, writeWorkoutScheduleDates, writeWorkoutDefs, readWorkoutDefs, writeDefaultWorkoutDefs, updateLogRows, deleteLogSession, writeCardioActivities, readCardioActivities, writeDefaultCardioActivities, readGarminActivities, readGarminWellnessEntries, readWithingsMeasurements, readSettings, writeSettings, mergeDateWindowEntries, mergeWorkoutSessionRows, mergeYearScopedEntries, withAuthRetry } from './firebase/index.js';
import type { DateWindow, YearBucketReadScope } from './firebase/index.js';
import { DATE_WINDOW_INCREMENT_DAYS, addDateDays, buildFirebaseLoadQueue, initialDateWindow, runFirebaseLoadQueue } from './firebase/load-plan.js';
import type { FirebaseLoadRequest } from './firebase/load-plan.js';
import type { LiftGoal } from './google/index.js';
import { signOutOfStronger } from './firebase/index.js';
import { authorizeCalendar, disconnectCalendar, syncScheduleWithCalendar, generateStrongerId, listEventsInRange, isStrongerEvent, getEventDate } from './google/index.js';
import type { CalendarSyncResult } from './google/index.js';
import type { WorkoutDefinition } from './data/sample-workouts.js';
import type { ParsedLogRow } from './google/index.js';
import { buildWorkoutsFromConfigs, createDefaultWorkoutImportDrafts, createDuplicateWorkoutDraft, workoutDefinitions, defaultCardioActivities } from './data/sample-workouts.js';
import { decodeSharedWorkout, encodeSharedWorkout, getImportedWorkoutName } from './data/workout-sharing.js';
import type { SharedWorkout } from './data/workout-sharing.js';
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
import { getSettingsRouteRedirect, useHashRouter } from './hooks/useHashRouter.js';
import { loadDraft, saveDraft, clearDraft } from './hooks/useWorkoutDraft.js';
import { clearSentinel as clearTimerSentinel } from './hooks/useRestTimer.js';
import type { StravaActivity, StravaGoal, StravaMetric, StravaTimeRange, StravaAggregation } from './model/strava.js';
import { filterActivitiesByRange } from './model/strava.js';
import type { WithingsMeasurement } from './model/types.js';
import type { WithingsGoal, WithingsMetric } from './model/withings.js';
import { toDisplayUnit } from './model/withings.js';
import { WithingsView } from './components/WithingsView.js';
import { GarminWellnessView } from './components/GarminWellnessView.js';
import { GarminActivitiesListView } from './components/GarminActivitiesListView.js';
import { DateRangeSelector } from './components/DateRangeSelector.js';
import './App.css';

const CALENDAR_SYNC_ID_SETTING = 'calendar.syncCalendarId';

function AppContent() {
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
  const [stravaGoals, setStravaGoals] = useState<StravaGoal[]>([]);
  const [garminActivities, setGarminActivities] = useState<StravaActivity[]>([]);
  const [wellnessEntries, setWellnessEntries] = useState<GarminWellnessEntry[]>([]);
  const [chartRange, setChartRange] = useState<StravaTimeRange>(String(new Date().getFullYear()));
  const [garminRange, setGarminRange] = useState<StravaTimeRange>('month');
  const [chartAggregation, setChartAggregation] = useState<StravaAggregation>('day');
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
  const [calendarSyncId, setCalendarSyncId] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [priorityLoadPending, setPriorityLoadPending] = useState(false);
  const [showDefaultWorkoutImportPrompt, setShowDefaultWorkoutImportPrompt] = useState(false);
  const [defaultWorkoutImportError, setDefaultWorkoutImportError] = useState<string | null>(null);
  const [duplicateWorkoutDraft, setDuplicateWorkoutDraft] = useState<WorkoutDefinition | undefined>(undefined);
  const settingsRef = useRef(new Map<string, string>());
  const definitionsRef = useRef<WorkoutDefinition[]>([]);
  // Ref so callbacks can read the current value without being in their dependency arrays.
  const roundWarmupPlateMathRef = useRef(DEFAULT_APP_SETTINGS.roundWarmupPlateMath);

  const logScopesLoadedRef = useRef(new Set<YearBucketReadScope>());
  const dataLoadsRef = useRef(new Map<string, Promise<void>>());
  const loadQueueUserRef = useRef<string | null>(null);
  const calendarWindowRef = useRef(initialDateWindow());
  const calendarWindowLoadRef = useRef(Promise.resolve());
  const calendarMutationRef = useRef<Promise<unknown>>(Promise.resolve());
  const connectedUserRef = useRef<string | null>(null);
  const sessionMutationRef = useRef(new Map<string, Promise<void>>());

  const queueSessionMutation = useCallback((key: string, mutation: () => Promise<void>): Promise<void> => {
    const previous = sessionMutationRef.current.get(key) ?? Promise.resolve();
    let queued: Promise<void>;
    queued = previous
      .catch(() => undefined)
      .then(mutation)
      .finally(() => {
        if (sessionMutationRef.current.get(key) === queued) {
          sessionMutationRef.current.delete(key);
        }
      });
    sessionMutationRef.current.set(key, queued);
    return queued;
  }, []);

  const queueCalendarMutation = useCallback(<T,>(mutation: () => Promise<T>): Promise<T> => {
    const queued = calendarMutationRef.current
      .catch(() => undefined)
      .then(mutation);
    calendarMutationRef.current = queued;
    return queued;
  }, []);

  const handleConnected = useCallback(
    (userId: string) => {
      if (connectedUserRef.current === userId) return;
      if (connectedUserRef.current) disconnectCalendar();
      connectedUserRef.current = userId;
      setCalendarSyncId(null);
      setSpreadsheetId(userId);
      setSheetConnected(true);
      setNeedsSetup(false);
      setDataLoadError(null);
      setPriorityLoadPending(true);
      setShowDefaultWorkoutImportPrompt(false);
      setDefaultWorkoutImportError(null);
      setDuplicateWorkoutDraft(undefined);
      logScopesLoadedRef.current.clear();
      dataLoadsRef.current.clear();
      loadQueueUserRef.current = null;
      calendarWindowRef.current = initialDateWindow();
      calendarWindowLoadRef.current = Promise.resolve();
      calendarMutationRef.current = Promise.resolve();
      setSettingsLoaded(false);
    },
    [],
  );

  const handleSetupConfirm = useCallback(
    async (configs: LiftConfig[]) => {
      if (!spreadsheetId) return;
      const setupUserId = spreadsheetId;

      // Write the user's configs to the sheet (writeDefaultConfig writes
      // the header row too, which is needed for a fresh config zone).
      await writeDefaultConfig(setupUserId, configs);
      if (connectedUserRef.current !== setupUserId) return;
      setConfigs(configs);

      // Read or write default workout definitions
      const liftNames = new Map(configs.map((c) => [c.id, c.name]));
      let defs = await readWorkoutDefs(setupUserId, liftNames);
      if (connectedUserRef.current !== setupUserId) return;
      if (!defs) {
        defs = [];
        setShowDefaultWorkoutImportPrompt(true);
        setDefaultWorkoutImportError(null);
      } else {
        setShowDefaultWorkoutImportPrompt(false);
        setDefaultWorkoutImportError(null);
      }
      setDefinitions(defs);

      // Read or seed default cardio activities
      let cardio = await readCardioActivities(setupUserId);
      if (connectedUserRef.current !== setupUserId) return;
      if (!cardio) {
        await writeDefaultCardioActivities(setupUserId, defaultCardioActivities);
        if (connectedUserRef.current !== setupUserId) return;
        cardio = [...defaultCardioActivities];
      }
      setCardioActivities(cardio);

      const builtWorkouts = buildWorkoutsFromConfigs(configs, defs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current });
      setWorkouts(builtWorkouts);
      setNeedsSetup(false);
      setDataLoadError(null);
    },
    [spreadsheetId],
  );

  const handleDisconnected = useCallback(() => {
    disconnectCalendar();
    if (!connectedUserRef.current) return;
    connectedUserRef.current = null;
    clearDraft();
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
    setShowDefaultWorkoutImportPrompt(false);
    setDefaultWorkoutImportError(null);
    setDuplicateWorkoutDraft(undefined);
    setCardioActivities([]);
    setGarminActivities([]);
    setWellnessEntries([]);
    setWithingsMeasurements([]);
    setWithingsGoals([]);
    setCalendarSyncId(null);
    logScopesLoadedRef.current.clear();
    dataLoadsRef.current.clear();
    loadQueueUserRef.current = null;
    calendarWindowRef.current = initialDateWindow();
    calendarWindowLoadRef.current = Promise.resolve();
    calendarMutationRef.current = Promise.resolve();
    setSettingsLoaded(false);
    replaceTo({ view: 'list' });
  }, [replaceTo]);

  const handleSignOut = useCallback(async () => {
    await signOutOfStronger();
    handleDisconnected();
  }, [handleDisconnected]);

  const loadPreviousSets = useCallback(
    async (sheetId: string, workoutId: string) => {
      try {
        if (connectedUserRef.current !== sheetId) return;
        // If log data is already loaded, use it directly
        const loadedScopes = logScopesLoadedRef.current;
        if (loadedScopes.has('all')
          || (loadedScopes.has('currentYear') && loadedScopes.has('otherYears'))) {
          const prev = findPreviousWorkoutSets(logRows, workoutId);
          if (connectedUserRef.current !== sheetId) return;
          setPreviousSets(prev);
          return;
        }
        // Otherwise fetch the complete Firestore history before starting.
        await withAuthRetry(async () => {
          const rows = await readLogZone(sheetId);
          if (connectedUserRef.current !== sheetId) return;
          setLogRows(rows);
          logScopesLoadedRef.current.add('all');
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
        ).then((savedRows) => {
          if (connectedUserRef.current !== sid) return;
          setLogRows((existing) => mergeWorkoutSessionRows(existing, savedRows));
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
      setWorkouts(buildWorkoutsFromConfigs(updatedConfigs, definitions, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
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

  const loadExercisesData = useCallback(async (userId: string) => {
    const loaded = await readConfigZone(userId);
    if (connectedUserRef.current !== userId) return;
    if (!loaded) {
      setNeedsSetup(true);
      return;
    }
    setConfigs(loaded);
    setNeedsSetup(false);
  }, []);

  const loadWorkoutDefinitionsData = useCallback(async (userId: string) => {
    let loaded = await readWorkoutDefs(userId);
    if (connectedUserRef.current !== userId) return;
    if (!loaded) {
      loaded = [];
      setShowDefaultWorkoutImportPrompt(true);
      setDefaultWorkoutImportError(null);
    } else {
      setShowDefaultWorkoutImportPrompt(false);
      setDefaultWorkoutImportError(null);
    }
    setDefinitions(loaded);
  }, []);

  const handleImportDefaultWorkouts = useCallback(async () => {
    if (!spreadsheetId) {
      setDefaultWorkoutImportError('Cannot import defaults right now. Reconnect to your sheet and try again.');
      return;
    }
    const userId = spreadsheetId;
    const defaultsToImport = createDefaultWorkoutImportDrafts(workoutDefinitions, generateStrongerId);
    try {
      await withAuthRetry(() => writeDefaultWorkoutDefs(userId, defaultsToImport));
      if (connectedUserRef.current !== userId) return;
      const updatedDefinitions = [
        ...definitionsRef.current,
        ...defaultsToImport,
      ];
      setDefinitions(updatedDefinitions);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefinitions, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
      setShowDefaultWorkoutImportPrompt(false);
      setDefaultWorkoutImportError(null);
    } catch (error) {
      if (connectedUserRef.current !== userId) return;
      setDefaultWorkoutImportError(error instanceof Error ? error.message : String(error));
    }
  }, [spreadsheetId, configs]);

  const handleDismissDefaultWorkoutImportPrompt = useCallback(() => {
    setShowDefaultWorkoutImportPrompt(false);
    setDefaultWorkoutImportError(null);
  }, []);

  const handleShowDefaultWorkoutImportPrompt = useCallback(() => {
    setShowDefaultWorkoutImportPrompt(true);
    setDefaultWorkoutImportError(null);
  }, []);

  const loadCardioActivitiesData = useCallback(async (userId: string) => {
    let loaded = await readCardioActivities(userId);
    if (connectedUserRef.current !== userId) return;
    if (!loaded) {
      loaded = defaultCardioActivities;
      await writeDefaultCardioActivities(userId, loaded);
      if (connectedUserRef.current !== userId) return;
    }
    setCardioActivities(loaded);
  }, []);

  // Schedule handlers
  const loadFlagsData = useCallback(async (
    sheetId: string,
    window?: DateWindow,
    required = false,
  ) => {
    try {
      await withAuthRetry(async () => {
        const flags = await readFlags(sheetId, window);
        if (connectedUserRef.current !== sheetId) return;
        setDayFlags((existing) => mergeDateWindowEntries(existing, flags, window));
      });
    } catch (error) {
      if (window && required) throw error;
      // Silently ignore — flags data is optional
    }
  }, []);

  const loadWorkoutScheduleData = useCallback(async (
    sheetId: string,
    window?: DateWindow,
    required = false,
  ) => {
    try {
      await withAuthRetry(async () => {
        const schedule = await readWorkoutSchedule(sheetId, window);
        if (connectedUserRef.current !== sheetId) return;
        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, schedule, window));
      });
    } catch (error) {
      if (window && required) throw error;
      // Silently ignore — schedule data is optional
    }
  }, []);

  const loadLogData = useCallback(async (
    sheetId: string,
    scope: YearBucketReadScope = 'all',
  ) => {
    try {
      await withAuthRetry(async () => {
        const rows = await readLogZone(sheetId, scope);
        if (connectedUserRef.current !== sheetId) return;
        setLogRows((existing) => mergeYearScopedEntries(existing, rows, scope));
        logScopesLoadedRef.current.add(scope);
      });
    } catch {
      // Silently ignore — log data is optional for calendar history
    }
  }, []);

  const loadSettingsData = useCallback(async (sheetId: string) => {
    try {
      await withAuthRetry(async () => {
        const settings = await readSettings(sheetId);
        if (connectedUserRef.current !== sheetId) return;
        settingsRef.current = settings;
        setStravaGoals(goalsFromSettings(settings));
        setWithingsGoals(bodyGoalsFromSettings(settings));
        setLiftGoals(liftGoalsFromSettings(settings));
        const parsed = appSettingsFromMap(settings);
        roundWarmupPlateMathRef.current = parsed.roundWarmupPlateMath;
        setAppSettings(parsed);
        setCalendarSyncId(settings.get(CALENDAR_SYNC_ID_SETTING)?.trim() || null);
      });
    } catch {
      // Silently ignore — settings data is optional
    } finally {
      if (connectedUserRef.current === sheetId) setSettingsLoaded(true);
    }
  }, []);

  const loadGarminData = useCallback(async (
    sheetId: string,
    scope: YearBucketReadScope = 'all',
  ) => {
    try {
      await withAuthRetry(async () => {
        const activities = await readGarminActivities(sheetId, scope);
        if (connectedUserRef.current !== sheetId) return;
        setGarminActivities((existing) => mergeYearScopedEntries(existing, activities, scope));
      });
    } catch {
      // Silently ignore — Garmin data is optional
    }
  }, []);

  const loadWellnessData = useCallback(async (
    sheetId: string,
    scope: YearBucketReadScope = 'all',
  ) => {
    try {
      await withAuthRetry(async () => {
        const entries = await readGarminWellnessEntries(sheetId, scope);
        if (connectedUserRef.current !== sheetId) return;
        setWellnessEntries((existing) => mergeYearScopedEntries(existing, entries, scope));
      });
    } catch {
      // Silently ignore — wellness data is optional
    }
  }, []);

  const loadWithingsData = useCallback(async (
    sheetId: string,
    scope: YearBucketReadScope = 'all',
  ) => {
    try {
      await withAuthRetry(async () => {
        const measurements = await readWithingsMeasurements(sheetId, scope);
        if (connectedUserRef.current !== sheetId) return;
        setWithingsMeasurements((existing) => mergeYearScopedEntries(existing, measurements, scope));
      });
    } catch {
      // Silently ignore — Withings data is optional
    }
  }, []);

  const loadCalendarWindow = useCallback((direction: 'future' | 'past'): Promise<void> => {
    const userId = spreadsheetId;
    if (!userId) return Promise.resolve();
    const pending = calendarWindowLoadRef.current.then(async () => {
      const current = calendarWindowRef.current;
      const window = direction === 'future'
        ? {
            startDate: current.endDate,
            endDate: addDateDays(current.endDate, DATE_WINDOW_INCREMENT_DAYS),
          }
        : {
            startDate: addDateDays(current.startDate, -DATE_WINDOW_INCREMENT_DAYS),
            endDate: current.startDate,
          };
      const [schedule, flags] = await Promise.all([
        readWorkoutSchedule(userId, window),
        readFlags(userId, window),
      ]);
      if (connectedUserRef.current !== userId) return;
      setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, schedule, window));
      setDayFlags((existing) => mergeDateWindowEntries(existing, flags, window));
      calendarWindowRef.current = direction === 'future'
        ? { ...current, endDate: window.endDate }
        : { ...current, startDate: window.startDate };
    });
    calendarWindowLoadRef.current = pending.catch(() => undefined);
    return pending;
  }, [spreadsheetId]);

  const handleScheduleAssign = useCallback(
    (date: string, workoutId: string) => {
      const userId = spreadsheetId;
      void queueCalendarMutation(async () => {
        const window = { startDate: date, endDate: addDateDays(date, 1) };
        const persisted = userId
          ? await withAuthRetry(() => readWorkoutSchedule(userId, window))
          : [];
        if (userId && connectedUserRef.current !== userId) return;
        const updatedDate = [...persisted, { date, workoutId, strongerId: generateStrongerId() }];
        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, updatedDate, window));
        if (userId) {
          await withAuthRetry(() => writeWorkoutScheduleDates(userId, updatedDate, [date]));
        }
      });
    },
    [queueCalendarMutation, spreadsheetId],
  );

  const handleBulkSchedule = useCallback(
    (entries: WorkoutScheduleEntry[]) => {
      const userId = spreadsheetId;
      void queueCalendarMutation(async () => {
        const changedDates = [...new Set(entries.map((entry) => entry.date))].sort();
        if (changedDates.length === 0) return;
        const window = {
          startDate: changedDates[0],
          endDate: addDateDays(changedDates[changedDates.length - 1], 1),
        };
        const persisted = userId
          ? await withAuthRetry(() => readWorkoutSchedule(userId, window))
          : [];
        if (userId && connectedUserRef.current !== userId) return;
        const datesToRest = new Set(
          entries.filter((entry) => entry.workoutId === '__rest__').map((entry) => entry.date),
        );
        const toAdd = entries.filter((entry) => entry.workoutId !== '__rest__');
        let updatedRange = persisted.map((entry) => {
          if (datesToRest.has(entry.date) && entry.workoutId) {
            return { ...entry, workoutId: '' };
          }
          return entry;
        });
        for (const entry of toAdd) {
          const exists = updatedRange.some(
            (current) => current.date === entry.date && current.workoutId === entry.workoutId,
          );
          if (!exists) {
            updatedRange.push({ ...entry, strongerId: entry.strongerId ?? generateStrongerId() });
          }
        }
        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, updatedRange, window));
        if (userId) {
          await withAuthRetry(() => writeWorkoutScheduleDates(userId, updatedRange, changedDates));
        }
      });
    },
    [queueCalendarMutation, spreadsheetId],
  );

  const handleScheduleRemove = useCallback(
    (date: string, workoutId: string) => {
      const userId = spreadsheetId;
      void queueCalendarMutation(async () => {
        const window = { startDate: date, endDate: addDateDays(date, 1) };
        const persisted = userId
          ? await withAuthRetry(() => readWorkoutSchedule(userId, window))
          : [];
        if (userId && connectedUserRef.current !== userId) return;
        let blanked = false;
        const updatedDate = persisted.map((entry) => {
          if (!blanked && entry.workoutId === workoutId) {
            blanked = true;
            return { ...entry, workoutId: '' };
          }
          return entry;
        });
        if (!blanked) return;
        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, updatedDate, window));
        if (userId) {
          await withAuthRetry(() => writeWorkoutScheduleDates(userId, updatedDate, [date]));
        }
      });
    },
    [queueCalendarMutation, spreadsheetId],
  );

  const handleUpdateLabel = useCallback(
    (date: string, workoutId: string, label: string) => {
      const trimmed = label.trim();
      const userId = spreadsheetId;
      void queueCalendarMutation(async () => {
        const window = { startDate: date, endDate: addDateDays(date, 1) };
        const persisted = userId
          ? await withAuthRetry(() => readWorkoutSchedule(userId, window))
          : [];
        if (userId && connectedUserRef.current !== userId) return;
        let updated = false;
        const updatedDate = persisted.map((entry) => {
          if (!updated && entry.workoutId === workoutId) {
            updated = true;
            return { ...entry, ...(trimmed ? { label: trimmed } : { label: undefined }) };
          }
          return entry;
        });
        if (!updated) return;
        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, updatedDate, window));
        if (userId) {
          await withAuthRetry(() => writeWorkoutScheduleDates(userId, updatedDate, [date]));
        }
      });
    },
    [queueCalendarMutation, spreadsheetId],
  );

  const handleUpdateFlags = useCallback(
    (date: string, key: keyof DayFlags) => {
      const userId = spreadsheetId;
      void queueCalendarMutation(async () => {
        const window = { startDate: date, endDate: addDateDays(date, 1) };
        const persisted = userId
          ? await withAuthRetry(() => readFlags(userId, window))
          : [];
        if (userId && connectedUserRef.current !== userId) return;
        const currentFlags = persisted[0]?.flags ?? {
          home: false,
          elsewhere: false,
          travel: false,
          visitors: false,
          alcohol: false,
          blocked: false,
        };
        const locationKeys: Array<keyof DayFlags> = ['home', 'elsewhere', 'travel'];
        let flags: DayFlags;
        if (locationKeys.includes(key)) {
          const currentLocation = currentFlags.travel
            ? 'travel'
            : currentFlags.elsewhere
              ? 'elsewhere'
              : 'home';
          flags = {
            ...currentFlags,
            home: false,
            elsewhere: false,
            travel: false,
            [key]: currentLocation !== key,
          };
        } else {
          flags = { ...currentFlags, [key]: !currentFlags[key] };
        }
        const hasFlags = Object.values(flags).some(Boolean);
        const updatedDate = hasFlags ? [{ date, flags }] : [];
        setDayFlags((existing) => mergeDateWindowEntries(existing, updatedDate, window));
        if (userId) {
          await withAuthRetry(() => writeFlagDates(userId, updatedDate, [date]));
        }
      });
    },
    [queueCalendarMutation, spreadsheetId],
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
    (calendarId: string): Promise<CalendarSyncResult> => queueCalendarMutation(async () => {
      const syncUserId = spreadsheetId;
      if (!syncUserId) throw new Error('Not connected to Firebase.');
      if (calendarSyncId && calendarSyncId !== calendarId) {
        throw new Error(
          'This Stronger account is linked to a different Google Calendar. '
          + 'Select the configured calendar before syncing.',
        );
      }
      const persistedSchedule = await withAuthRetry(() => readWorkoutSchedule(syncUserId));
      if (connectedUserRef.current !== syncUserId) {
        throw new Error('Firebase user changed during calendar sync.');
      }
      const resolveWorkoutName = (workoutId: string): string | null => {
        if (workoutId === REST_ID) return 'Rest';
        if (workoutId.startsWith('cardio:')) {
          const cardioId = workoutId.slice('cardio:'.length);
          const c = cardioActivities.find((a) => a.id === cardioId);
          return c?.name ?? null;
        }
        const w = workouts.find((wk) => wk.id === workoutId);
        return w?.name ?? null;
      };

      const resolveWorkoutId = (name: string): string | null => {
        if (name === 'Rest') return REST_ID;
        // Try strength workouts first
        const w = workouts.find((wk) => wk.name === name);
        if (w) return w.id;
        // Try cardio activities
        const c = cardioActivities.find((a) => a.name === name);
        if (c) return `cardio:${c.id}`;
        return null;
      };

      const scheduleWithIds = persistedSchedule.map((entry) =>
        entry.workoutId && !entry.strongerId
          ? { ...entry, strongerId: generateStrongerId() }
          : entry,
      );
      if (scheduleWithIds.some((entry, index) => entry !== persistedSchedule[index])) {
        await withAuthRetry(() => writeWorkoutScheduleDates(
          syncUserId,
          scheduleWithIds,
          new Set(scheduleWithIds.map((entry) => entry.date)),
        ));
        if (connectedUserRef.current !== syncUserId) throw new Error('Firebase user changed during calendar sync.');
        setWorkoutSchedule(scheduleWithIds);
      }

      const hasLinkedEntries = scheduleWithIds.some((entry) => Boolean(entry.calendarEventId));
      const { updatedSchedule, result, calendarVerified } = await withAuthRetry(() => syncScheduleWithCalendar(
        calendarId,
        scheduleWithIds,
        resolveWorkoutName,
        resolveWorkoutId,
        {
          allowRemoteDeletions: calendarSyncId === calendarId,
          requireLinkedMatch: !calendarSyncId && hasLinkedEntries,
        },
      ));

      if (connectedUserRef.current !== syncUserId) throw new Error('Firebase user changed during calendar sync.');
      if (!calendarVerified) return result;
      await withAuthRetry(() => writeWorkoutScheduleDates(
        syncUserId,
        updatedSchedule,
        new Set([
          ...scheduleWithIds.map((entry) => entry.date),
          ...updatedSchedule.map((entry) => entry.date),
        ]),
      ));
      if (!calendarSyncId) {
        const latestSettings = await withAuthRetry(() => readSettings(syncUserId));
        latestSettings.set(CALENDAR_SYNC_ID_SETTING, calendarId);
        await withAuthRetry(() => writeSettings(syncUserId, latestSettings));
        if (connectedUserRef.current !== syncUserId) throw new Error('Firebase user changed during calendar sync.');
        settingsRef.current = latestSettings;
        setCalendarSyncId(calendarId);
      }
      setWorkoutSchedule(updatedSchedule);
      return result;
    }),
    [queueCalendarMutation, workouts, cardioActivities, spreadsheetId, calendarSyncId],
  );

  const handleClearSchedule = useCallback(
    (options: ClearOptions): Promise<ClearResult> => queueCalendarMutation(async () => {
      const { startDate, weeks, clearFlags: shouldClearFlags, clearSchedule: shouldClearSchedule } = options;
      const result: ClearResult = { flagsCleared: 0, scheduleCleared: 0, calendarEventsDeleted: 0, errors: [] };
      const calendarId = shouldClearSchedule ? calendarSyncId : null;
      let calendarAuthorized = false;
      if (calendarId) {
        try {
          await authorizeCalendar();
          calendarAuthorized = true;
        } catch (err) {
          result.errors.push(`Could not authorize Google Calendar cleanup: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

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
      const dateWindow = { startDate, endDate };
      const [persistedFlags, persistedSchedule] = await Promise.all([
        shouldClearFlags && spreadsheetId
          ? withAuthRetry(() => readFlags(spreadsheetId, dateWindow))
          : Promise.resolve([]),
        shouldClearSchedule && spreadsheetId
          ? withAuthRetry(() => readWorkoutSchedule(spreadsheetId, dateWindow))
          : Promise.resolve([]),
      ]);
      if (spreadsheetId && connectedUserRef.current !== spreadsheetId) {
        throw new Error('Firebase user changed while clearing the calendar.');
      }
      // Clear flags
      if (shouldClearFlags) {
        const before = persistedFlags.length;
        const updatedFlags = persistedFlags.filter((e) => !dateSet.has(e.date));
        result.flagsCleared = before - updatedFlags.length;
        setDayFlags((existing) => mergeDateWindowEntries(existing, updatedFlags, dateWindow));
        if (spreadsheetId) {
          try {
            await withAuthRetry(() => writeFlagDates(spreadsheetId, updatedFlags, dateSet));
          } catch (err) {
            result.errors.push(`Failed to write flags: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Clear workout schedule
      if (shouldClearSchedule) {
        // Collect entries in the date range that have workoutIds
        const entriesToClear = persistedSchedule.filter((e) => dateSet.has(e.date) && e.workoutId);
        result.scheduleCleared = entriesToClear.length;

        // Blank out workoutIds (preserves calendarEventId/strongerId for cleanup)
        const updatedSchedule = persistedSchedule.map((e) => {
          if (dateSet.has(e.date) && e.workoutId) {
            return { ...e, workoutId: '' };
          }
          return e;
        });

        // Try to delete Google Calendar events for cleared entries
        const deletedEventIds = new Set<string>();
        if (calendarId && calendarAuthorized) {
          const gapi = window.gapi;
          if (gapi) {
            // Delete events we have direct references to
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
          } else {
            result.errors.push('Google Calendar client did not initialize for cleanup.');
          }
        }

        // After deleting calendar events, remove entries that no longer serve a purpose
        // (those with no workoutId and whose calendar events were deleted or had none)
        const finalSchedule = updatedSchedule.filter((e) => {
          if (!dateSet.has(e.date)) return true; // keep entries outside range
          if (e.workoutId) return true; // keep entries with workoutIds
          // Retain linkage unless the referenced event was confirmed deleted.
          if (e.calendarEventId && !deletedEventIds.has(e.calendarEventId)) return true;
          return false;
        });

        setWorkoutSchedule((existing) => mergeDateWindowEntries(existing, finalSchedule, dateWindow));
        if (spreadsheetId) {
          try {
            await withAuthRetry(() => writeWorkoutScheduleDates(spreadsheetId, finalSchedule, dateSet));
          } catch (err) {
            result.errors.push(`Failed to write schedule: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return result;
    }),
    [queueCalendarMutation, spreadsheetId, calendarSyncId],
  );

  const handleUpdateLogRows = useCallback(
    async (sessionDate: string, sessionWorkoutId: string, sessionStartTime: string, updatedRows: ParsedLogRow[]) => {
      const userId = spreadsheetId;
      if (!userId) throw new Error('Not connected to Firebase.');
      const sessionKey = `${sessionDate}|${sessionWorkoutId}|${sessionStartTime}`;
      await queueSessionMutation(sessionKey, () =>
        withAuthRetry(() => updateLogRows(userId, sessionDate, sessionWorkoutId, sessionStartTime, updatedRows)));
      if (connectedUserRef.current !== userId) return;
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
    },
    [queueSessionMutation, spreadsheetId],
  );

  const handleDeleteSession = useCallback(
    async (sessionDate: string, sessionWorkoutId: string, sessionStartTime: string) => {
      const userId = spreadsheetId;
      if (!userId) throw new Error('Not connected to Firebase.');
      const sessionKey = `${sessionDate}|${sessionWorkoutId}|${sessionStartTime}`;
      await queueSessionMutation(sessionKey, () =>
        withAuthRetry(() => deleteLogSession(userId, sessionDate, sessionWorkoutId, sessionStartTime)));
      if (connectedUserRef.current !== userId) return;
      setLogRows((prev) =>
        prev.filter(
          (r) =>
            !(r.date === sessionDate && r.workoutId === sessionWorkoutId && r.startTime === sessionStartTime),
        ),
      );
    },
    [queueSessionMutation, spreadsheetId],
  );

  const handleViewSession = useCallback((session: LogSession) => {
    setViewingSession(session);
  }, []);

  const handleViewSessionSave = useCallback(
    async (updatedRows: ParsedLogRow[]) => {
      if (!viewingSession) return;
      const { date, workoutId, startTime } = viewingSession.key;
      await handleUpdateLogRows(date, workoutId, startTime, updatedRows);
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

  const handleOpenGarminActivities = useCallback(() => {
    navigateTo({ view: 'garmin-activities' });
  }, [navigateTo]);

  const handleOpenWellness = useCallback(() => {
    navigateTo({ view: 'wellness' });
  }, [navigateTo]);

  const handleOpenWithings = useCallback(() => {
    navigateTo({ view: 'withings' });
  }, [navigateTo]);

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
      if (key === 'roundWarmupPlateMath') {
        roundWarmupPlateMathRef.current = value;
      }
      if (spreadsheetId) {
        appSettingsToMap(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  const handleAppNumericSettingChange = useCallback((key: AppNumericSettingKey, value: number) => {
    setAppSettings((prev) => {
      const updated = { ...prev, [key]: value };
      if (spreadsheetId) {
        appSettingsToMap(updated, settingsRef.current);
        void withAuthRetry(() => writeSettings(spreadsheetId, settingsRef.current)).catch(() => {});
      }
      return updated;
    });
  }, [spreadsheetId]);

  // Editor handlers
  const handleEditWorkout = useCallback((workoutId: string) => {
    setDuplicateWorkoutDraft(undefined);
    navigateTo({ view: 'editor', workoutId });
  }, [navigateTo]);

  const handleNewWorkout = useCallback(() => {
    setDuplicateWorkoutDraft(undefined);
    navigateTo({ view: 'editor' });
  }, [navigateTo]);

  const handleDuplicateWorkout = useCallback(
    (workoutId: string) => {
      const source = definitions.find((d) => d.id === workoutId);
      if (!source) return;
      const newId = generateStrongerId();
      const newDef = createDuplicateWorkoutDraft(source, newId);
      setDuplicateWorkoutDraft(newDef);
      navigateTo({ view: 'editor' });
    },
    [definitions, navigateTo],
  );

  const handleShareWorkout = useCallback(
    async (workoutId: string) => {
      const definition = definitions.find((item) => item.id === workoutId);
      if (!definition) return;
      const data = encodeSharedWorkout(definition);
      const url = `${window.location.origin}${window.location.pathname}#/import/${data}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: definition.name, text: 'Import this workout into Stronger', url });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          window.alert('Workout link copied.');
        } else {
          window.prompt('Copy this workout link:', url);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        window.prompt('Copy this workout link:', url);
      }
    },
    [definitions],
  );

  const handleImportWorkout = useCallback(
    (shared: SharedWorkout) => {
      const imported: WorkoutDefinition = {
        ...shared,
        id: generateStrongerId(),
        name: getImportedWorkoutName(shared.name, definitions.map((item) => item.name)),
      };
      const updatedDefs = [...definitions, imported];
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }
      navigateTo({ view: 'list' });
    },
    [definitions, configs, spreadsheetId, navigateTo],
  );

  const handleDeleteWorkoutFromList = useCallback(
    (workoutId: string) => {
      if (!confirm('Delete this workout?')) return;
      const updatedDefs = definitions.filter((d) => d.id !== workoutId);
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
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
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
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
    setDuplicateWorkoutDraft(undefined);
    navigateTo({ view: 'list' });
  }, [navigateTo]);

  const handleDeleteWorkout = useCallback(
    (workoutId: string) => {
      const updatedDefs = definitions.filter((d) => d.id !== workoutId);
      setDefinitions(updatedDefs);
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));
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
      setWorkouts(buildWorkoutsFromConfigs(updatedConfigs, definitions, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));

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
      setWorkouts(buildWorkoutsFromConfigs(configs, updatedDefs, { roundWarmupPlateMath: roundWarmupPlateMathRef.current }));

      if (spreadsheetId) {
        void withAuthRetry(() => writeWorkoutDefs(spreadsheetId, updatedDefs));
      }

      setDuplicateWorkoutDraft(undefined);
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

  useEffect(() => {
    if (route.view !== 'editor' && duplicateWorkoutDraft) {
      setDuplicateWorkoutDraft(undefined);
    }
  }, [route.view, duplicateWorkoutDraft]);

  const executeDatasetLoad = useCallback((
    request: FirebaseLoadRequest,
    userId: string,
    phase: 'priority' | 'deferred',
  ): Promise<void> => {
    const { dataset, scope } = request;
    const window = scope === 'initialWindow' ? calendarWindowRef.current : undefined;
    const yearScope: YearBucketReadScope = scope === 'initialWindow' ? 'all' : scope;
    switch (dataset) {
      case 'exercises': return loadExercisesData(userId);
      case 'workouts': return loadWorkoutDefinitionsData(userId);
      case 'cardioActivities': return loadCardioActivitiesData(userId);
      case 'schedule': return loadWorkoutScheduleData(userId, window, phase === 'priority');
      case 'dayFlags': return loadFlagsData(userId, window, phase === 'priority');
      case 'workoutSessions': return loadLogData(userId, yearScope);
      case 'settings': return loadSettingsData(userId);
      case 'garminActivities': return loadGarminData(userId, yearScope);
      case 'garminWellness': return loadWellnessData(userId, yearScope);
      case 'withingsMeasurements': return loadWithingsData(userId, yearScope);
    }
  }, [
    loadCardioActivitiesData,
    loadExercisesData,
    loadFlagsData,
    loadGarminData,
    loadLogData,
    loadSettingsData,
    loadWellnessData,
    loadWithingsData,
    loadWorkoutDefinitionsData,
    loadWorkoutScheduleData,
  ]);

  const loadDataset = useCallback((
    request: FirebaseLoadRequest,
    userId: string,
    phase: 'priority' | 'deferred',
  ): Promise<void> => {
    const key = `${request.dataset}:${request.scope}`;
    const existing = dataLoadsRef.current.get(key);
    if (existing) return existing;
    const pending = executeDatasetLoad(request, userId, phase).catch((error) => {
      dataLoadsRef.current.delete(key);
      throw error;
    });
    dataLoadsRef.current.set(key, pending);
    return pending;
  }, [executeDatasetLoad]);

  useEffect(() => {
    if (!spreadsheetId || loadQueueUserRef.current === spreadsheetId) return;
    loadQueueUserRef.current = spreadsheetId;
    const userId = spreadsheetId;
    const queue = buildFirebaseLoadQueue(route.view);
    void runFirebaseLoadQueue(
      queue,
      (request, phase) => loadDataset(request, userId, phase),
      async () => {
        if (connectedUserRef.current === userId) setPriorityLoadPending(false);
        await ensureUser(userId);
      },
    ).catch((reason) => {
      if (connectedUserRef.current !== userId) return;
      setPriorityLoadPending(false);
      setDataLoadError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [loadDataset, route.view, spreadsheetId]);

  // Rebuild computed workouts whenever roundWarmupPlateMath changes so warmup weights update immediately.
  useEffect(() => {
    if (configs.length > 0) {
      setWorkouts(buildWorkoutsFromConfigs(configs, definitions, { roundWarmupPlateMath: appSettings.roundWarmupPlateMath }));
    }
  }, [appSettings.roundWarmupPlateMath, configs, definitions]);

  useEffect(() => {
    definitionsRef.current = definitions;
  }, [definitions]);

  useEffect(() => {
    const redirect = getSettingsRouteRedirect(route, settingsLoaded, appSettings);
    if (redirect) replaceTo(redirect);
  }, [
    route.view,
    settingsLoaded,
    appSettings.showCalendarTab,
    appSettings.showGarminTab,
    replaceTo,
  ]);

  // Gate: require auth + sheet connection before showing workouts
  if (!sheetConnected) {
    return (
      <GoogleAuth
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
      />
    );
  }

  if (dataLoadError) {
    return (
      <div className="auth-screen">
        <p className="auth-error">{dataLoadError}</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
        <button className="btn-link" onClick={() => void handleSignOut()}>Sign out</button>
      </div>
    );
  }

  if (priorityLoadPending) {
    return <div className="auth-screen"><p className="auth-status">Loading…</p></div>;
  }

  // Show setup page for first-time users (empty config zone)
  if (needsSetup) {
    return (
      <SetupPage
        onConfirm={handleSetupConfirm}
      />
    );
  }

  const onOpenCalendar = appSettings.showCalendarTab ? handleOpenCalendar : undefined;
  const onOpenGarmin = appSettings.showGarminTab ? handleOpenGarmin : undefined;
  const onOpenWellness = appSettings.showGarminTab ? handleOpenWellness : undefined;
  const onOpenGarminActivities = appSettings.showGarminTab ? handleOpenGarminActivities : undefined;
  const onOpenWithings = undefined;

  if (route.view === 'import') {
    const shared = decodeSharedWorkout(route.data);
    const importedName = shared
      ? getImportedWorkoutName(shared.name, definitions.map((item) => item.name))
      : null;
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <section className="workout-import" aria-labelledby="workout-import-title">
          {shared ? (
            <>
              <h1 id="workout-import-title">Import workout?</h1>
              <p><strong>{shared.name}</strong></p>
              <p className="workout-import-details">
                {shared.templates.length} {shared.templates.length === 1 ? 'exercise' : 'exercises'}
                {importedName !== shared.name && <> · Will be named <strong>{importedName}</strong></>}
              </p>
              <div className="workout-import-actions">
                <button className="btn-link" onClick={() => navigateTo({ view: 'list' })}>Cancel</button>
                <button className="btn-primary" onClick={() => handleImportWorkout(shared)}>Import</button>
              </div>
            </>
          ) : (
            <>
              <h1 id="workout-import-title">Invalid workout link</h1>
              <p className="workout-import-details">This shared workout could not be read.</p>
              <button className="btn-primary" onClick={() => navigateTo({ view: 'list' })}>Back to workouts</button>
            </>
          )}
        </section>
      </>
    );
  }

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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <WorkoutEditor
          key={editDef?.id ?? duplicateWorkoutDraft?.id ?? 'new'}
          existing={editDef}
          initialDefinition={editDef ? undefined : duplicateWorkoutDraft}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <CalendarView
          workouts={workouts}
          workoutDefinitions={definitions}
          cardioActivities={cardioActivities}
          workoutSchedule={workoutSchedule}
          dayFlags={dayFlags}
          logRows={logRows}
          onAssign={handleScheduleAssign}
          onRemove={handleScheduleRemove}
          onUpdateLabel={handleUpdateLabel}
          onOpenWorkout={handleCalendarOpenWorkout}
          onUpdateLogRows={handleUpdateLogRows}
          onDeleteSession={handleDeleteSession}
          onBulkSchedule={handleBulkSchedule}
          onUpdateFlags={handleUpdateFlags}
          onSyncCalendar={handleSyncCalendar}
          calendarSyncId={calendarSyncId}
          onClearSchedule={handleClearSchedule}
          onLoadMoreDays={() => loadCalendarWindow('future')}
          onLoadPreviousDays={() => loadCalendarWindow('past')}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <div className="chart-controls-sticky">
          <DateRangeSelector value={chartRange} onChange={setChartRange} />
          <div className="strava-agg-group">
            {(['day', 'week', 'month'] as StravaAggregation[]).map((agg) => (
              <button
                key={agg}
                className={`strava-agg-btn${chartAggregation === agg ? ' active' : ''}`}
                onClick={() => setChartAggregation(agg)}
              >
                {agg.charAt(0).toUpperCase() + agg.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <ProgressView
          logRows={logRows}
          liftGoals={liftGoals}
          onLiftGoalChange={handleLiftGoalChange}
          dipThresholdPercent={appSettings.progressDipThresholdPercent}
          skipDips={appSettings.skipProgressDips}
          range={chartRange}
          bodyWeights={withingsMeasurements.map((m) => ({
            date: m.date,
            weight: toDisplayUnit('weight', m.weight),
          }))}
        />
        {withingsMeasurements.length > 0 && (
          <div className="strava-view">
            <h3 className="strava-section-title">Body Composition</h3>
            <WithingsView
              measurements={withingsMeasurements}
              goals={withingsGoals}
              dipThresholdPercent={appSettings.withingsDipThresholdPercent}
              skipDips={appSettings.skipBodyCompDips}
              range={chartRange}
              aggregation={chartAggregation}
              onGoalChange={handleWithingsGoalChange}
              embedded
            />
          </div>
        )}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <div className="chart-controls-sticky">
          <DateRangeSelector value={garminRange} onChange={setGarminRange} />
          <div className="strava-agg-group">
            {(['day', 'week', 'month'] as StravaAggregation[]).map((agg) => (
              <button
                key={agg}
                className={`strava-agg-btn${chartAggregation === agg ? ' active' : ''}`}
                onClick={() => setChartAggregation(agg)}
              >
                {agg.charAt(0).toUpperCase() + agg.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="strava-view">
          <GarminWellnessView
            entries={wellnessEntries}
            range={garminRange}
            aggregation={chartAggregation}
            stepsGoal={appSettings.garminDailyStepsGoal}
            floorsGoal={appSettings.garminDailyFloorsGoal}
            sleepHoursGoal={appSettings.garminDailySleepHoursGoal}
            weeklyIntensityMinGoal={appSettings.garminWeeklyIntensityMinGoal}
            embedded
          />
        </div>
      </>
    );
  }

  if (route.view === 'garmin-activities') {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <div className="chart-controls-sticky">
          <DateRangeSelector value={garminRange} onChange={setGarminRange} />
          <div className="strava-agg-group">
            {(['day', 'week', 'month'] as StravaAggregation[]).map((agg) => (
              <button
                key={agg}
                className={`strava-agg-btn${chartAggregation === agg ? ' active' : ''}`}
                onClick={() => setChartAggregation(agg)}
              >
                {agg.charAt(0).toUpperCase() + agg.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="strava-view">
          <ActivitiesView
            activities={garminActivities}
            goals={stravaGoals}
            range={garminRange}
            aggregation={chartAggregation}
            onGoalChange={handleStravaGoalChange}
            title={null}
            emptyText="No Garmin data yet. Run the Garmin sync to populate the 'Stronger - Garmin' tab."
            embedded
          />
          <GarminActivitiesListView activities={garminActivities} range={garminRange} />
        </div>
      </>
    );
  }

  if (route.view === 'withings') {
    navigateTo({ view: 'progress' });
    return null;
  }

  if (route.view === 'settings' && spreadsheetId) {
    return (
      <>
        <GoogleAuth
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onGoToList={handleGoToList}
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
          onOpenSettings={handleOpenSettings}
        />
        <SettingsView
          onSignOut={handleSignOut}
          appSettings={appSettings}
          onAppSettingChange={handleAppSettingChange}
          onAppNumericSettingChange={handleAppNumericSettingChange}
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
          onOpenCalendar={onOpenCalendar}
          onOpenExercises={handleOpenExercises}
          onOpenProgress={handleOpenProgress}
          onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
          onOpenWithings={onOpenWithings}
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
        onOpenCalendar={onOpenCalendar}
        onOpenExercises={handleOpenExercises}
        onOpenProgress={handleOpenProgress}
        onOpenGarmin={onOpenGarmin}
          onOpenWellness={onOpenWellness}
          onOpenGarminActivities={onOpenGarminActivities}
        onOpenWithings={onOpenWithings}
        onOpenSettings={handleOpenSettings}
      />
      <WorkoutSelect
        workouts={workouts}
        missingLiftIds={missingLiftIds}
        workoutSchedule={workoutSchedule}
        logRows={logRows}
        showDefaultWorkoutImportPrompt={showDefaultWorkoutImportPrompt}
        defaultWorkoutImportError={defaultWorkoutImportError}
        onImportDefaultWorkouts={handleImportDefaultWorkouts}
        onShowDefaultWorkoutImportPrompt={handleShowDefaultWorkoutImportPrompt}
        onDismissDefaultWorkoutImportPrompt={handleDismissDefaultWorkoutImportPrompt}
        onSelect={handleSelectWorkout}
        onViewSession={handleViewSession}
        onEdit={handleEditWorkout}
        onDuplicate={handleDuplicateWorkout}
        onShare={handleShareWorkout}
        onDelete={handleDeleteWorkoutFromList}
        onNew={handleNewWorkout}
        onToggleFavorite={handleToggleFavorite}
        cardioActivities={cardioActivities}
        onCardioSave={handleCardioSave}
      />
    </>
  );
}

function App() {
  return (
    <AppContent />
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
): Promise<ParsedLogRow[]> {
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

  return withAuthRetry(() => appendLogRows(sheetId, rows));
}
