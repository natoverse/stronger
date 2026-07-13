import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Acquires a Screen Wake Lock while the component is mounted and enabled,
 * preventing the device screen from turning off (e.g. during a workout).
 *
 * - Re-acquires the lock when the page regains visibility (browsers
 *   release the lock when the tab is hidden).
 * - Re-acquires the lock when the sentinel fires its `release` event
 *   (the OS can revoke the lock at any time, e.g. low battery).
 * - Exposes `active` state and a manual `reacquire()` for the UI.
 *
 * Silently no-ops on browsers that don't support the Wake Lock API.
 *
 * @param enabled Whether the wake lock should be active. Defaults to true.
 */
export function useWakeLock(enabled = true) {
	const wakeLockRef = useRef<WakeLockSentinel | null>(null);
	const [active, setActive] = useState(false);
	const activeRef = useRef(false);
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;
	activeRef.current = active;

	const acquire = useCallback(async () => {
		// Only request when enabled AND the page is visible (the API
		// throws NotAllowedError for hidden documents).
		if (!enabledRef.current || !('wakeLock' in navigator)) return;
		if (document.visibilityState !== 'visible') return;
		if (wakeLockRef.current && !wakeLockRef.current.released) {
			setActive(true);
			return;
		}

		try {
			const sentinel = await navigator.wakeLock.request('screen');

			// Attach a handler so we know when the browser/OS revokes the lock.
			sentinel.addEventListener('release', () => {
				// Only clear state if this is still the current sentinel.
				if (wakeLockRef.current === sentinel) {
					wakeLockRef.current = null;
					setActive(false);
					// Auto-reacquire (e.g. after tab switch, OS revoke).
					if (enabledRef.current && document.visibilityState === 'visible') {
						void acquire();
					}
				}
			});

			wakeLockRef.current = sentinel;
			setActive(true);
		} catch {
			// Request can fail (low battery, hidden tab, etc.) — ignore.
			setActive(false);
		}
	}, []);

	useEffect(() => {
		if (!enabled || !('wakeLock' in navigator)) {
			setActive(false);
			return;
		}

		void acquire();

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible' && enabledRef.current) {
				void acquire();
			}
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			// Release on unmount / when disabled.
			const sentinel = wakeLockRef.current;
			wakeLockRef.current = null;
			setActive(false);
			if (sentinel) {
				void sentinel.release();
			}
		};
	}, [enabled, acquire]);

	useEffect(() => {
		if (!enabled || activeRef.current) return;

		const retryOnUserGesture = () => {
			void acquire();
		};

		window.addEventListener('pointerdown', retryOnUserGesture, { passive: true });
		window.addEventListener('keydown', retryOnUserGesture);

		return () => {
			window.removeEventListener('pointerdown', retryOnUserGesture);
			window.removeEventListener('keydown', retryOnUserGesture);
		};
	}, [enabled, active, acquire]);

	return { active, reacquire: acquire };
}
