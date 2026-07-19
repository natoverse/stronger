# Firebase Setup

Stronger uses Firebase Auth to handle Google sign-in. Firebase persists the session in IndexedDB so the app loads without requiring a sign-in click on every page reload. Google API access tokens (for Sheets and Calendar) are obtained automatically via `signInWithPopup` when the user has an active Google session.

You need a Firebase project alongside the Google Cloud project you set up in [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

## 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Enter a project name (e.g. `Stronger`) and click **Continue**.
4. Disable Google Analytics if you don't need it, then click **Create project**.
5. Wait for the project to be created, then click **Continue**.

> **Tip:** If you already have a Google Cloud project from GOOGLE_SETUP.md, you can link Firebase to it. On the project creation screen click the dropdown under the project name and select your existing Cloud project. Firebase and GCP will share the same project.

## 2. Register a web app

1. From the Firebase project overview, click the **Web** icon (`</>`) under "Get started by adding Firebase to your app".
2. Enter an app nickname (e.g. `Stronger Web`) and leave "Also set up Firebase Hosting" unchecked.
3. Click **Register app**.
4. Firebase shows the `firebaseConfig` object — copy the four values you'll need:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`
5. Click **Continue to console**.

## 3. Enable Google sign-in

1. In the left sidebar go to **Build → Authentication**.
2. Click **Get started** (first time only).
3. Under the **Sign-in method** tab, click **Google**.
4. Toggle **Enable** on.
5. Set a **Project support email** (your email address).
6. Click **Save**.

## 4. Add your app's domain to authorized domains

Firebase blocks sign-in redirects from unknown origins. You need to add every domain the app runs on.

1. Still in **Build → Authentication**, go to the **Settings** tab.
2. Under **Authorized domains**, click **Add domain**.
3. Add each domain where the app runs:

   | Environment | Domain to add |
   |---|---|
   | GitHub Pages | `<your-username>.github.io` |
   | Local dev | `localhost` (already present by default) |

4. Click **Add** after each entry.

## 5. Update the Google OAuth client for Firebase redirect URIs

Firebase sign-in uses a redirect through `<your-project-id>.firebaseapp.com`. You need to add that as an authorized redirect URI in the Google Cloud Console.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. Click on the OAuth 2.0 Client ID you created in GOOGLE_SETUP.md.
3. Under **Authorized redirect URIs**, click **Add URI** and add:
   ```
   https://<your-project-id>.firebaseapp.com/__/auth/handler
   ```
   Replace `<your-project-id>` with your Firebase project ID (the `projectId` value from step 2).
4. Click **Save**.

> **Why is this needed?** Firebase Auth routes the OAuth callback through a Firebase-hosted handler (`/__/auth/handler`) before returning control to your app. Without this redirect URI the Google sign-in popup will fail with an error 400 "redirect_uri_mismatch".

## 6. Configure environment variables

The app reads the Firebase config from four `VITE_FIREBASE_*` environment variables at build time. You also still need `VITE_GOOGLE_CLIENT_ID` from GOOGLE_SETUP.md.

### Local development

Create (or update) a `.env.local` file in the project root (this file is git-ignored):

```bash
VITE_GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com

VITE_FIREBASE_API_KEY=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=1:123456789000:web:abcdef1234567890abcdef
```

Then start the dev server:

```bash
npm run dev
```

### GitHub Pages deployment

Add the four Firebase values as **repository secrets** (Settings → Secrets and variables → Actions → New repository secret):

| Secret name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` from Firebase |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` from Firebase |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` from Firebase |
| `VITE_FIREBASE_APP_ID` | `appId` from Firebase |

These are already wired into the `deploy.yml` workflow and will be injected automatically at build time.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Firebase: Error (auth/configuration-not-found)" | The `VITE_FIREBASE_*` env vars are missing or empty. Check your `.env.local` or CI secrets. |
| Sign-in popup fails with "redirect_uri_mismatch" (error 400) | The Firebase redirect URI (`https://<project-id>.firebaseapp.com/__/auth/handler`) is not in the OAuth client's **Authorized redirect URIs**. See step 5. |
| "auth/unauthorized-domain" | The domain the app is running on is not in Firebase's **Authorized domains** list. See step 4. |
| Sign-in popup opens but immediately closes with no error | The `VITE_GOOGLE_CLIENT_ID` may be missing or wrong, or the OAuth consent screen isn't configured. Check GOOGLE_SETUP.md. |
| Signing in works locally but fails on GitHub Pages | Make sure `<your-username>.github.io` is added to Firebase's **Authorized domains** and the Firebase redirect URI is in the Google OAuth client. |
