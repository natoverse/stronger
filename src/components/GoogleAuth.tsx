import { useCallback, useEffect, useRef, useState } from 'react'
import {
	isFirebaseConfigured,
	observeAuth,
	signInToStronger,
	signOutOfStronger,
} from '../firebase/index.ts'
import { withTimeout } from '../firebase/timeout.ts'
import { isMockMode } from '../data/mock-data.ts'
import { Calendar, Dumbbell, HeartPulse, Library, Settings, SportShoe, TrendingUp } from 'lucide-react'

const AUTH_RESTORE_TIMEOUT_MS = 15_000
const SIGN_IN_TIMEOUT_MS = 60_000

interface Props {
	onConnected: (userId: string) => void
	onDisconnected: () => void
	hideConnectedUi?: boolean
	onOpenCalendar?: () => void
	onOpenExercises?: () => void
	onOpenProgress?: () => void
	onOpenGarmin?: () => void
	onOpenWellness?: () => void
	onOpenGarminActivities?: () => void
	onOpenWithings?: () => void
	onOpenSettings?: () => void
	onGoToList?: () => void
}

type Phase = 'loading' | 'sign-in' | 'connected' | 'error'

export function GoogleAuth({
	onConnected,
	onDisconnected,
	hideConnectedUi = false,
	onOpenCalendar,
	onOpenExercises,
	onOpenProgress,
	onOpenGarmin,
	onOpenWellness,
	onOpenGarminActivities,
	onOpenWithings,
	onOpenSettings,
	onGoToList,
}: Props) {
	const mockMode = isMockMode()
	const [phase, setPhase] = useState<Phase>(mockMode ? 'connected' : 'loading')
	const [error, setError] = useState<string | null>(null)
	const [signInPending, setSignInPending] = useState(false)
	const authGenerationRef = useRef(0)

	const connect = useCallback((uid: string, generation: number) => {
		if (authGenerationRef.current !== generation) return
		setPhase('connected')
		onConnected(uid)
	}, [onConnected])

	useEffect(() => {
		if (mockMode) return
		if (!isFirebaseConfigured()) {
			setError('Firebase is not configured. Set the VITE_FIREBASE_* environment variables.')
			setPhase('error')
			return
		}
		let restored = false
		const restoreTimeout = window.setTimeout(() => {
			if (restored) return
			setError('Restoring your session timed out. Check your connection and retry.')
			setPhase('error')
		}, AUTH_RESTORE_TIMEOUT_MS)
		const unsubscribe = observeAuth((user) => {
			restored = true
			window.clearTimeout(restoreTimeout)
			const generation = ++authGenerationRef.current
			if (!user) {
				setPhase('sign-in')
				onDisconnected()
				return
			}
			setPhase('loading')
			connect(user.uid, generation)
		}, (reason) => {
			restored = true
			window.clearTimeout(restoreTimeout)
			setError(reason.message || 'Unable to restore your session.')
			setPhase('error')
			onDisconnected()
		})
		return () => {
			window.clearTimeout(restoreTimeout)
			authGenerationRef.current += 1
			unsubscribe()
		}
	}, [connect, mockMode, onDisconnected])

	const handleSignIn = useCallback(async () => {
		if (signInPending) return
		setSignInPending(true)
		setError(null)
		try {
			await withTimeout(
				signInToStronger(),
				SIGN_IN_TIMEOUT_MS,
				'Sign-in timed out. Close any open popup and retry.',
			)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Sign-in failed.')
			setPhase('sign-in')
		} finally {
			setSignInPending(false)
		}
	}, [signInPending])

	if (phase === 'loading') {
		return <div className="auth-screen"><p className="auth-status">Restoring session…</p></div>
	}

	if (phase === 'sign-in') {
		return (
			<div className="auth-screen">
				<h1 className="app-title">Stronger</h1>
				<p className="subtitle">
					Sign in once to keep Stronger connected on this device.
					Google Calendar connects separately only when you sync.
				</p>
				{error && <p className="auth-error">{error}</p>}
				<button className="btn-google" onClick={handleSignIn} disabled={signInPending}>
					{signInPending ? 'Signing in…' : 'Sign in to Stronger'}
				</button>
			</div>
		)
	}

	if (phase === 'error') {
		return (
			<div className="auth-screen">
				<h1 className="app-title">Stronger</h1>
				{error && <p className="auth-error">{error}</p>}
				<button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
				<button className="btn-link" onClick={() => void signOutOfStronger()}>Sign out</button>
			</div>
		)
	}

	if (hideConnectedUi) return null

	const onOpenGarminWellness = onOpenGarmin || onOpenWellness
	return (
		<div className="auth-connected">
			<div className="toolbar-nav">
				{onGoToList && <button className="btn-toolbar" onClick={onGoToList} title="Workouts"><Dumbbell size={20} /></button>}
				{onOpenCalendar && <button className="btn-toolbar" onClick={onOpenCalendar} title="Schedule"><Calendar size={20} /></button>}
				{onOpenExercises && <button className="btn-toolbar" onClick={onOpenExercises} title="Exercises"><Library size={20} /></button>}
				{onOpenProgress && <button className="btn-toolbar" onClick={onOpenProgress} title="Progress"><TrendingUp size={20} /></button>}
				{onOpenGarminWellness && <button className="btn-toolbar" onClick={onOpenGarminWellness} title="Wellness"><HeartPulse size={20} /></button>}
				{onOpenGarminActivities && <button className="btn-toolbar" onClick={onOpenGarminActivities} title="Activities"><SportShoe size={20} /></button>}
				{onOpenWithings && <button className="btn-toolbar" onClick={onOpenWithings} title="Body Composition"><HeartPulse size={20} /></button>}
				{onOpenSettings && <button className="btn-toolbar" onClick={onOpenSettings} title="Settings"><Settings size={20} /></button>}
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
