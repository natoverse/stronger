import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  type User,
} from 'firebase/auth';

const APP_NAME = 'migration-bootstrap';

export interface FirebaseBootstrapConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

export function hasFirebaseBootstrapConfig(config: FirebaseBootstrapConfig): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function isFirebaseBootstrapConfigured(): boolean {
  return hasFirebaseBootstrapConfig(firebaseConfig);
}

function getBootstrapAuth() {
  if (!isFirebaseBootstrapConfigured()) {
    throw new Error('Firebase Authentication is not configured.');
  }

  const app = getApps().some((candidate) => candidate.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(firebaseConfig, APP_NAME);

  return getAuth(app);
}

let persistenceReady: Promise<void> | null = null;

function ensurePersistence(): Promise<void> {
  persistenceReady ??= setPersistence(getBootstrapAuth(), browserLocalPersistence);
  return persistenceReady;
}

export function observeFirebaseBootstrapUser(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(getBootstrapAuth(), callback);
}

export async function signInForFirebaseMigration(): Promise<User> {
  await ensurePersistence();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(getBootstrapAuth(), provider)).user;
}
