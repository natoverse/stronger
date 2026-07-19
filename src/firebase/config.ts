/**
 * Firebase app initialisation.
 *
 * Reads configuration from Vite environment variables.
 * Set VITE_FIREBASE_* in your .env (or GitHub Actions secrets for CI/CD).
 */

import { initializeApp, getApps } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
	appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

// Initialise lazily so that test environments with empty config don't
// throw at module load time. Auth will fail at call time if unconfigured.
let _auth: Auth | null = null

try {
	// Guard against double-initialisation in React StrictMode
	const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
	_auth = getAuth(app)
} catch {
	// Firebase not configured (e.g. missing env vars in test environment).
	// _auth remains null; sign-in calls will throw at use time, not at
	// module load time, so importing code is not affected.
}

/** Firebase Auth instance — null when Firebase is not configured (e.g. test env). */
export const firebaseAuth: Auth | null = _auth
