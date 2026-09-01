import {
	browserLocalPersistence,
	onAuthStateChanged,
	setPersistence,
	signInWithPopup,
	signOut as firebaseSignOut,
	type User,
} from 'firebase/auth'
import { firebaseAuth, googleAuthProvider } from './client.ts'

let persistenceReady: Promise<void> | null = null

function ensurePersistence(): Promise<void> {
	persistenceReady ??= setPersistence(firebaseAuth, browserLocalPersistence)
	return persistenceReady
}

export function observeAuth(callback: (user: User | null) => void): () => void {
	void ensurePersistence()
	return onAuthStateChanged(firebaseAuth, callback)
}

export async function signInToStronger(): Promise<User> {
	await ensurePersistence()
	const credential = await signInWithPopup(firebaseAuth, googleAuthProvider)
	return credential.user
}

export function signOutOfStronger(): Promise<void> {
	return firebaseSignOut(firebaseAuth)
}
