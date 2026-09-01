import { describe, expect, it } from 'vitest';
import { hasFirebaseBootstrapConfig } from '../bootstrap-auth.ts';

describe('Firebase authentication bootstrap', () => {
  it('requires every Firebase Authentication identifier', () => {
    expect(hasFirebaseBootstrapConfig({
      apiKey: 'api-key',
      authDomain: 'project.firebaseapp.com',
      projectId: 'project',
      appId: 'app-id',
    })).toBe(true);

    expect(hasFirebaseBootstrapConfig({
      apiKey: 'api-key',
      authDomain: 'project.firebaseapp.com',
      projectId: 'project',
    })).toBe(false);
  });
});

