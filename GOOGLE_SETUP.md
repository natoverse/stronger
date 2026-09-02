# Google OAuth Setup

Stronger uses Google OAuth to read and write a Google Sheet on your behalf, and optionally push workout events to Google Calendar. You need to create a Google Cloud project with the Sheets and Calendar APIs enabled and an OAuth 2.0 client ID.

## 1. Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector in the top bar, then **New Project**.
3. Name it something like `Stronger` and click **Create**.
4. Make sure the new project is selected in the project selector.

## 2. Enable the Google Sheets API and Google Calendar API

1. In the left sidebar go to **APIs & Services → Library** (or visit [the API library](https://console.cloud.google.com/apis/library)).
2. Search for **Google Sheets API** and click on it.
3. Click **Enable**.
4. Go back to the API library, search for **Google Calendar API** and click on it.
5. Click **Enable**.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Select **External** as the user type and click **Create**.
3. Fill in the required fields:
   - **App name**: `Stronger` (or whatever you like)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue**.
5. On the **Scopes** step, click **Add or Remove Scopes** and add:
   ```
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/calendar
   ```
   Then click **Update** and **Save and Continue**.
6. On the **Test users** step, click **Add Users** and add the Google account(s) you'll sign in with. While the app is in "Testing" mode only these accounts can authenticate.
7. Click **Save and Continue**, then **Back to Dashboard**.

> **Note:** The app will stay in "Testing" mode by default, which is fine for personal use. Test users must be explicitly added. If you want anyone to be able to sign in, you would need to go through Google's verification process and publish the app — this is not necessary for personal use.

## 4. Create an OAuth 2.0 Client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Give it a name like `Stronger Web Client`.
5. Under **Authorized JavaScript origins**, add the GitHub Pages origin:

   ```text
   https://<your-username>.github.io
   ```

   > Do **not** add a trailing slash or path. Origins are scheme + host + port only.

6. You can leave **Authorized redirect URIs** empty — the app uses the implicit grant flow (Google Identity Services popup), not a redirect-based flow.
7. Click **Create**.
8. Copy the **Client ID** — it looks like `123456789-abcdef.apps.googleusercontent.com`.

## 5. Configure GitHub Pages

The app reads the client ID from the `VITE_GOOGLE_CLIENT_ID` environment variable at build time.

Add `VITE_GOOGLE_CLIENT_ID` as a **repository secret**
(Settings → Secrets and variables → Actions → New repository secret). The
deployment workflow passes it to the Vite build:

```yaml
- name: Build
  run: npm run build
  env:
    VITE_GOOGLE_CLIENT_ID: ${{ secrets.VITE_GOOGLE_CLIENT_ID }}
```

## 6. Create your Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet (or use an existing one).
2. The app will automatically create a tab named **Stronger** the first time it connects.
3. Copy the spreadsheet URL — you'll paste it into the app after signing in.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Google OAuth client ID is not configured" | The `VITE_GOOGLE_CLIENT_ID` repository secret is missing or empty. Add it and rerun the GitHub Pages deployment. |
| Sign-in popup closes immediately / `idpiframe_initialization_failed` | The current origin is not in your client's **Authorized JavaScript origins**. Double-check scheme, host, and port. |
| "Access blocked: This app's request is invalid" (error 400) | The OAuth consent screen may not be configured, or the origin is wrong. |
| "The caller does not have permission" when connecting a sheet | The Google account you signed in with doesn't have access to the spreadsheet. Share the sheet with that account. |
| Only specific people can sign in | The app is in "Testing" mode. Add their email to the test users list in the OAuth consent screen, or publish the app. |
