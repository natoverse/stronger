import { FirebaseError, getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import {
	browserLocalPersistence,
	browserPopupRedirectResolver,
	browserSessionPersistence,
	getAuth,
	GoogleAuthProvider,
	indexedDBLocalPersistence,
	initializeAuth,
} from 'firebase/auth'
import { getFirestore, initializeFirestore } from 'firebase/firestore'

const firebaseConfig: FirebaseOptions = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function isFirebaseConfigured(): boolean {
	return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const firebaseAuth = (() => {
	try {
		return initializeAuth(app, {
			persistence: [
				indexedDBLocalPersistence,
				browserLocalPersistence,
				browserSessionPersistence,
			],
			popupRedirectResolver: browserPopupRedirectResolver,
		})
	} catch (error) {
		if (error instanceof FirebaseError && error.code === 'auth/already-initialized') {
			return getAuth(app)
		}
		throw error
	}
})()
export const googleAuthProvider = new GoogleAuthProvider()

export const firestore = (() => {
	try {
		return initializeFirestore(app, { ignoreUndefinedProperties: true })
	} catch {
		return getFirestore(app)
	}
})()
