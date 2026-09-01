import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Database } from 'lucide-react';
import {
  isFirebaseBootstrapConfigured,
  observeFirebaseBootstrapUser,
  signInForFirebaseMigration,
} from '../firebase/bootstrap-auth.js';

interface FirebaseIdentity {
  uid: string;
  email: string | null;
}

export default function FirebaseMigrationIdentity() {
  const configured = isFirebaseBootstrapConfigured();
  const [identity, setIdentity] = useState<FirebaseIdentity | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    return observeFirebaseBootstrapUser((user) => {
      setIdentity(user ? { uid: user.uid, email: user.email } : null);
    });
  }, [configured]);

  const handleSignIn = useCallback(async () => {
    setPending(true);
    setCopied(false);
    setError(null);
    try {
      const user = await signInForFirebaseMigration();
      setIdentity({ uid: user.uid, email: user.email });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Firebase sign-in failed.');
    } finally {
      setPending(false);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!identity) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(identity.uid);
      setCopied(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not copy the Firebase UID.');
    }
  }, [identity]);

  return (
    <div className="settings-section settings-section-firebase">
      <h3 className="settings-section-title">
        <Database size={18} />
        Firebase Migration Identity
      </h3>
      <p className="settings-disconnect-description">
        Sign in to the shared Firebase project to create the permanent user ID
        required by the migration action. This does not read or write Firestore.
      </p>

      {!configured && (
        <p className="config-warning">
          Firebase Authentication is not configured for this deployment. Add
          the VITE_FIREBASE_* build variables before creating a migration ID.
        </p>
      )}

      {configured && identity && (
        <div className="firebase-migration-identity">
          {identity.email && <span className="firebase-migration-email">{identity.email}</span>}
          <code className="firebase-migration-uid">{identity.uid}</code>
          <button className="btn-primary firebase-migration-copy" onClick={() => void handleCopy()}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'Copied' : 'Copy Firebase UID'}
          </button>
        </div>
      )}

      {configured && (
        <button
          className={identity ? 'btn-link firebase-migration-switch' : 'btn-google'}
          disabled={pending}
          onClick={() => void handleSignIn()}
        >
          {pending
            ? 'Signing in...'
            : identity
              ? 'Choose another Google account'
              : 'Create Firebase migration ID'}
        </button>
      )}

      {error && <p className="auth-error firebase-migration-error">{error}</p>}
    </div>
  );
}
