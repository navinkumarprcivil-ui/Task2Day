# Task2Day for Android

The Android app is the same `index.html` running inside a [Capacitor](https://capacitorjs.com) shell.

- **Offline.** The whole app ships inside the APK, so it opens with no connection. Your data is kept on the phone, and changes sync to Firebase once the connection is back.
- **Notifications.** The phone schedules these itself, so they ring with the app closed and with no connection:
  - the morning reminder every day;
  - each appointment in the coming week, 10 minutes before it starts.
- **Sign-in.** Uses the Google account already on the phone. Google doesn't allow its sign-in page inside apps, so the web popup can't be used here.
- **Back button.** Closes whatever is open, then returns to Today, then leaves the app.

## One-time setup

1. **Add the Android app in Firebase.** Open Firebase console → Project settings → *Add app* → Android.
   - Package name: `app.task2day`.
   - Download `google-services.json`.
2. **Give the build that file.** Open GitHub → repo *Settings → Secrets and variables → Actions → New repository secret*. Name it `GOOGLE_SERVICES_JSON` and paste in the whole file.
3. **Register the signing fingerprints.** In Firebase → Project settings → your Android app → *Add fingerprint*, add each SHA-1 below. Without them, Google sign-in fails with error 10.
   - **Debug APK:** GitHub builds this with a fresh debug key every run. For sign-in to keep working, use a release key as in step 4.
   - **Release key:** get its SHA-1 with `keytool -list -v -keystore task2day.keystore`.
   - **Play Store installs:** after the first upload, copy the *App signing key* SHA-1 from Play Console → *Test and release → App integrity* and add it as well.
   - After adding fingerprints, download `google-services.json` again and update the secret.
4. **Create a release key**, once, and keep the file and passwords safe forever:
   ```
   keytool -genkey -v -keystore task2day.keystore -alias task2day -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 task2day.keystore   # paste the output into the secret below
   ```
   Then add these repository secrets:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (set to `task2day`)
   - `ANDROID_KEY_PASSWORD`

## Getting a build

Every push to `main` runs the **Android build** workflow. You can also start it from GitHub → *Actions → Android build → Run workflow*. Each run produces:

- `task2day-debug-apk`: install it directly on a phone to try the app.
- `task2day-release-aab`: only produced when the signing secrets are set. Upload this to Play Console, starting with *Internal testing*.

## Changing the app

1. Edit `build/template.html` as usual, then run `python3 tools/bundle.py pack`.
2. The web site and the Android build both pick the change up from `main`.
3. A phone gets the new version only when the new APK or AAB is installed; the app doesn't update itself the way the website does.

To build locally you need Android Studio. Then:

```
npm ci && npm run sync
npx cap open android
```
