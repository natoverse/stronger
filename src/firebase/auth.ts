import {
	onAuthStateChanged,
	signInWithPopup,
	signOut as firebaseSignOut,
	type User,
} from 'firebase/auth'
import { firebaseAuth, googleAuthProvider } from './client.ts'

export function observeAuth(callback: (user: User | null) => void): () => void {
	return onAuthStateChanged(firebaseAuth, callback)
}

export async function signInToStronger(): Promise<User> {
	const credential = await signInWithPopup(firebaseAuth, googleAuthProvider)
	return credential.user
}

export function signOutOfStronger(): Promise<void> {
	return firebaseSignOut(firebaseAuth)
}
