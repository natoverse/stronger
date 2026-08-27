import { useState, useEffect, useCallback } from 'react'
import type { Workout, LiftConfig, CardioActivity } from '../model/index.ts'
import { buildWorkoutsFromConfigs, workoutDefinitions } from '../data/sample-workouts.ts'
import type { WorkoutDefinition } from '../data/sample-workouts.ts'
import {
	loadGapi,
	loadGis,
	initGapiClient,
	initTokenClient,
	signIn,
	signOut,
	hydrateStoredAccessToken,
	clearAuth,
	isAuthError,
	isSignInCanceledError,
	extractSheetId,
	saveSheetId,
	loadSheetId,
	clearSheetId,
	createSpreadsheet,
	connectToSheet,
	readConfigZone,
	verifyWorkoutDefsTab,
	createWorkoutDefsTab,
	readWorkoutDefs,
	writeDefaultWorkoutDefs,
	verifyLogTab,
	createLogTab,
	verifyCardioTab,
	createCardioTab,
	verifyMealLogTab,
	createMealLogTab,
	verifyMealFavoritesTab,
	createMealFavoritesTab,
	verifyMealRecentsTab,
	createMealRecentsTab,
	readCardioActivities,
	writeDefaultCardioActivities,
	describeSheetError,
} from '../google/index.ts'
import { defaultCardioActivities } from '../data/sample-workouts.ts'
import { Dumbbell, Calendar, Library, TrendingUp, Settings, HeartPulse, Pizza, SportShoe } from 'lucide-react'

type Phase =
	| 'loading' // loading Google scripts
	| 'sign-in' // waiting for user to sign in
	| 'sheet-input' // signed in, need sheet URL
	| 'connecting' // verifying sheet access
	| 'connected' // ready to use
	| 'error' // something went wrong

interface Props {
	onConnected: (workouts: Workout[], configs: LiftConfig[], spreadsheetId: string, definitions: WorkoutDefinition[], cardioActivities: CardioActivity[]) => void
	onDisconnected: () => void
	onNeedsSetup?: (spreadsheetId: string) => void
	onOpenCalendar?: () => void
	onOpenExercises?: () => void
	onOpenProgress?: () => void
	onOpenGarmin?: () => void
	onOpenWellness?: () => void
	onOpenGarminActivities?: () => void
	onOpenWithings?: () => void
	onOpenNutrition?: () => void
	onOpenSettings?: () => void
	onGoToList?: () => void
}

export function GoogleAuth({ onConnected, onDisconnected, onNeedsSetup, onOpenCalendar, onOpenExercises, onOpenProgress, onOpenGarmin, onOpenWellness, onOpenGarminActivities, onOpenWithings, onOpenNutrition, onOpenSettings, onGoToList }: Props) {
	const [phase, setPhase] = useState<Phase>('loading')
	const [error, setError] = useState<string | null>(null)
	const [sheetUrl, setSheetUrl] = useState('')
	const [sheetName, setSheetName] = useState('Stronger')
	const [signInPending, setSignInPending] = useState(false)

	/* ---------------------------------------------------------------- */
	/*  Load Google scripts and restore an unexpired token on load     */
	/* ---------------------------------------------------------------- */
	useEffect(() => {
		let cancelled = false

		async function init() {
			try {
				await Promise.all([loadGapi(), loadGis()])
				await initGapiClient()
				if (cancelled) return
				initTokenClient()

				// Reuse the token only for its Google-provided lifetime.
				// Once it expires, wait for an explicit sign-in click.
				const authed = hydrateStoredAccessToken()
				if (cancelled) return

				if (!authed) {
					setPhase('sign-in')
					return
				}

				const storedId = loadSheetId()
				if (storedId) {
					setPhase('connecting')
					await tryConnect(storedId)
				} else {
					setPhase('sheet-input')
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err))
					setPhase('error')
				}
			}
		}

		init()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	/* ---------------------------------------------------------------- */
	/*  Helpers                                                          */
	/* ---------------------------------------------------------------- */

	const tryConnect = useCallback(async (spreadsheetId: string) => {
		/**
		 * Inner function that performs the actual connection + data load.
		 * Extracted so we can retry once after re-authenticating.
		 */
		const attemptConnect = async () => {
			await connectToSheet(spreadsheetId)
			saveSheetId(spreadsheetId)

			// Read config zone — if empty, signal setup needed
			const configs = await readConfigZone(spreadsheetId)
			if (!configs) {
				// Ensure tabs exist before handing off to setup
				const defsTabExists = await verifyWorkoutDefsTab(spreadsheetId)
				if (!defsTabExists) {
					await createWorkoutDefsTab(spreadsheetId)
				}
				const logTabExists = await verifyLogTab(spreadsheetId)
				if (!logTabExists) {
					await createLogTab(spreadsheetId)
				}
				// Ensure cardio tab exists
				const cardioTabExists = await verifyCardioTab(spreadsheetId)
				if (!cardioTabExists) {
					await createCardioTab(spreadsheetId)
				}
				if (!await verifyMealLogTab(spreadsheetId)) await createMealLogTab(spreadsheetId)
				if (!await verifyMealFavoritesTab(spreadsheetId)) await createMealFavoritesTab(spreadsheetId)
				if (!await verifyMealRecentsTab(spreadsheetId)) await createMealRecentsTab(spreadsheetId)

				setPhase('connected')
				if (onNeedsSetup) {
					onNeedsSetup(spreadsheetId)
				}
				return
			}

			// Read workout defs — if tab missing or empty, create + write defaults
			const defsTabExists = await verifyWorkoutDefsTab(spreadsheetId)
			if (!defsTabExists) {
				await createWorkoutDefsTab(spreadsheetId)
			}

			// Ensure log tab exists
			const logTabExists = await verifyLogTab(spreadsheetId)
			if (!logTabExists) {
				await createLogTab(spreadsheetId)
			}

			// Ensure cardio tab exists
			const cardioTabExists = await verifyCardioTab(spreadsheetId)
			if (!cardioTabExists) {
				await createCardioTab(spreadsheetId)
			}
			if (!await verifyMealLogTab(spreadsheetId)) await createMealLogTab(spreadsheetId)
			if (!await verifyMealFavoritesTab(spreadsheetId)) await createMealFavoritesTab(spreadsheetId)
			if (!await verifyMealRecentsTab(spreadsheetId)) await createMealRecentsTab(spreadsheetId)

			// Build a lift-name lookup for exercise display names
			const liftNames = new Map(configs.map((c) => [c.id, c.name]))

			let defs = await readWorkoutDefs(spreadsheetId, liftNames)
			if (!defs) {
				await writeDefaultWorkoutDefs(spreadsheetId, workoutDefinitions)
				defs = workoutDefinitions
			}

			// Read cardio activities — if empty, seed with defaults
			let cardio = await readCardioActivities(spreadsheetId)
			if (!cardio) {
				await writeDefaultCardioActivities(spreadsheetId, defaultCardioActivities)
				cardio = defaultCardioActivities
			}

			const workouts = buildWorkoutsFromConfigs(configs, defs)
			setPhase('connected')
			onConnected(workouts, configs, spreadsheetId, defs, cardio)
		}

		try {
			setPhase('connecting')
			setError(null)
			await attemptConnect()
		} catch (err) {
			if (isAuthError(err)) {
				clearAuth()
				setPhase('sign-in')
				return
			}
			setError(describeSheetError(err))
			setPhase('error')
		}
	}, [onConnected, onNeedsSetup])

	const handleSignIn = useCallback(async () => {
		if (signInPending) return
		const signInPromise = signIn()
		setSignInPending(true)
		try {
			setError(null)
			await signInPromise
			// Signed in – check for stored sheet
			const storedId = loadSheetId()
			if (storedId) {
				await tryConnect(storedId)
			} else {
				setPhase('sheet-input')
			}
		} catch (err) {
			setError(isSignInCanceledError(err)
				? null
				: err instanceof Error ? err.message : 'Sign-in failed.')
			setPhase('sign-in')
		} finally {
			setSignInPending(false)
		}
	}, [signInPending, tryConnect])

	const handleSheetSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault()
			const id = extractSheetId(sheetUrl)
			if (!id) {
				setError('That doesn\'t look like a Google Sheets URL.')
				return
			}
			setError(null)
			await tryConnect(id)
		},
		[sheetUrl, tryConnect],
	)

	const handleCreateSheet = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault()
			const name = sheetName.trim()
			if (!name) {
				setError('Please enter a name for the sheet.')
				return
			}
			try {
				setError(null)
				setPhase('connecting')
				const spreadsheetId = await createSpreadsheet(name)
				await tryConnect(spreadsheetId)
			} catch (err) {
				setError(
					err instanceof Error ? err.message : 'Failed to create the sheet.',
				)
				setPhase('error')
			}
		},
		[sheetName, tryConnect],
	)

	const handleRetry = useCallback(async () => {
		const storedId = loadSheetId()
		if (storedId) {
			await tryConnect(storedId)
		} else {
			setPhase('sheet-input')
		}
	}, [tryConnect])

	const handleConnectDifferent = useCallback(() => {
		clearSheetId()
		setError(null)
		setPhase('sheet-input')
	}, [])

	const handleSignOut = useCallback(async () => {
		await signOut()
		setSheetUrl('')
		setError(null)
		setPhase('sign-in')
		onDisconnected()
	}, [onDisconnected])

	/* ---------------------------------------------------------------- */
	/*  Render                                                           */
	/* ---------------------------------------------------------------- */

	if (phase === 'loading') {
		return (
			<div className="auth-screen">
				<p className="auth-status">Loading…</p>
			</div>
		)
	}

	if (phase === 'sign-in') {
		const isReturning = !!loadSheetId()
		return (
			<div className="auth-screen">
				<h1 className="app-title">Stronger</h1>
				<p className="subtitle">
					{isReturning
						? 'Your session has expired. Sign in to continue.'
						: 'Sign in to connect your Google Sheet'}
				</p>
				{error && <p className="auth-error">{error}</p>}
				<button className="btn-google" onClick={handleSignIn} disabled={signInPending}>
					{signInPending ? 'Signing in…' : 'Sign in with Google'}
				</button>
			</div>
		)
	}

	if (phase === 'sheet-input') {
		return (
			<div className="auth-screen">
				<h1 className="app-title">Stronger</h1>
				{error && <p className="auth-error">{error}</p>}

				<div className="sheet-option">
					<p className="sheet-option-label">Create new sheet</p>
					<form className="sheet-form" onSubmit={handleCreateSheet}>
						<input
							className="sheet-url-input"
							type="text"
							placeholder="Sheet name"
							value={sheetName}
							onChange={(e) => setSheetName(e.target.value)}
							autoFocus
						/>
						<button className="btn-primary" type="submit">
							Create &amp; connect
						</button>
					</form>
				</div>

				<div className="sheet-divider">
					<span>or</span>
				</div>

				<div className="sheet-option">
					<p className="sheet-option-label">Connect to existing sheet</p>
					<form className="sheet-form" onSubmit={handleSheetSubmit}>
						<input
							className="sheet-url-input"
							type="url"
							placeholder="https://docs.google.com/spreadsheets/d/…"
							value={sheetUrl}
							onChange={(e) => setSheetUrl(e.target.value)}
						/>
						<button className="btn-primary" type="submit">
							Connect
						</button>
					</form>
				</div>

				<button className="btn-link" onClick={handleSignOut}>
					Sign out
				</button>
			</div>
		)
	}

	if (phase === 'connecting') {
		return (
			<div className="auth-screen">
				<p className="auth-status">Connecting to sheet…</p>
			</div>
		)
	}

	if (phase === 'error') {
		return (
			<div className="auth-screen">
				<h1 className="app-title">Stronger</h1>
				{error && <p className="auth-error">{error}</p>}
				<button className="btn-primary" onClick={handleRetry}>
					Retry
				</button>
				<button className="btn-link" onClick={handleConnectDifferent}>
					Connect a different sheet
				</button>
				<button className="btn-link" onClick={handleSignOut}>
					Sign out
				</button>
			</div>
		)
	}

	// phase === 'connected'
	const onOpenGarminWellness = onOpenGarmin || onOpenWellness

	return (
		<div className="auth-connected">
			<div className="toolbar-nav">
				{onGoToList && (
					<button className="btn-toolbar" onClick={onGoToList} title="Workouts">
						<Dumbbell size={20} />
					</button>
				)}
				{onOpenCalendar && (
					<button className="btn-toolbar" onClick={onOpenCalendar} title="Schedule">
						<Calendar size={20} />
					</button>
				)}
				{onOpenExercises && (
					<button className="btn-toolbar" onClick={onOpenExercises} title="Exercises">
						<Library size={20} />
					</button>
				)}
				{onOpenProgress && (
					<button className="btn-toolbar" onClick={onOpenProgress} title="Progress">
						<TrendingUp size={20} />
					</button>
				)}
				{onOpenGarminWellness && (
					<button className="btn-toolbar" onClick={onOpenGarminWellness} title="Wellness">
						<HeartPulse size={20} />
					</button>
				)}
				{onOpenGarminActivities && (
					<button className="btn-toolbar" onClick={onOpenGarminActivities} title="Activities">
						<SportShoe size={20} />
					</button>
				)}
				{onOpenWithings && (
					<button className="btn-toolbar" onClick={onOpenWithings} title="Body Composition">
						<HeartPulse size={20} />
					</button>
				)}
				{onOpenNutrition && (
					<button className="btn-toolbar" onClick={onOpenNutrition} title="Nutrition">
						<Pizza size={20} />
					</button>
				)}
				{onOpenSettings && (
					<button className="btn-toolbar" onClick={onOpenSettings} title="Settings">
						<Settings size={20} />
					</button>
				)}
			</div>
			<a
				className="btn-toolbar"
				href="https://github.com/natoverse/stronger"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="Stronger on GitHub"
				title="Stronger on GitHub"
			>
				<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
				</svg>
			</a>
		</div>
	)
}
