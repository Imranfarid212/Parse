# Switching Google sign-in from the browser flow to the native sheet

The app code for this landed already. Everything below is console work that
cannot be done from the repository, and until it is done the native path stays
switched off and Google sign-in keeps running through the browser.

**What this fixes.** The browser flow opens `ASWebAuthenticationSession`, which
shares Safari's cookie jar, so iOS shows a consent dialog naming the first host
in the OAuth chain. That host is Supabase's `/auth/v1/authorize`, so users read
*"Parse wants to use wfboznibkhsfxteejxco.supabase.co to sign in"*. The native
sheet has no browser and no redirect, so there is no dialog — the same reason
Apple sign-in never showed one.

**How the switch is armed.** Two independent gates, both off right now:

| Gate | Condition | Where |
| --- | --- | --- |
| Build | `REVERSED_CLIENT_ID` present in `GoogleService-Info.plist` | `app.config.ts` |
| Runtime | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set | `auth-context.tsx` |

Neither is a feature flag to flip by hand. Both become true as a side effect of
doing the steps below correctly, which is deliberate: a build with the URL
scheme but no client id, or the reverse, would fail at the moment a user taps
the button rather than at build time.

---

## 1. Enable Google as a sign-in provider in Firebase

Firebase console → project `parse-6b0c2` → **Authentication** → **Sign-in
method** → **Google** → enable, then save.

This is the step that has never been done. The credential files in the repo were
downloaded for Crashlytics and Analytics, which is why `GoogleService-Info.plist`
has no `CLIENT_ID` and `google-services.json` has an empty `oauth_client` array.

Enabling the provider provisions OAuth clients in the Google Cloud project behind
`parse-6b0c2` — a Web client, and an iOS client matching bundle id
`com.imranfarid.parse`.

While on that page, expand **Web SDK configuration** and copy the **Web client
ID**. It ends in `.apps.googleusercontent.com`. Step 4 needs it.

## 2. Add the Android SHA-1, if Android matters to you

Firebase console → **Project settings** → **Your apps** → the Android app →
**Add fingerprint**.

The Android OAuth client is bound to your signing certificate, not just the
package name, and Google sign-in on Android fails with a bare `DEVELOPER_ERROR`
if the fingerprint does not match. You need the debug keystore's SHA-1 for local
builds and the Play App Signing SHA-1 for anything from the store. iOS does not
have an equivalent requirement — skip this step if you are only shipping the
iOS build for now.

## 3. Re-download both credential files

- **Project settings** → iOS app → download `GoogleService-Info.plist` → replace
  the one at the repository root.
- **Project settings** → Android app → download `google-services.json` → replace
  the one at the repository root.

Confirm the plist now carries the key the build gate looks for:

```bash
grep -c REVERSED_CLIENT_ID GoogleService-Info.plist
```

`1` means the config plugin will apply on the next prebuild. `0` means the
provider did not actually enable in step 1, and continuing past this point will
produce a build whose native sheet cannot hand its result back to the app.

## 4. Register the client IDs with Supabase

Supabase dashboard → **Authentication** → **Providers** → **Google**.

Two things here, and the second one is the step people miss.

**Client IDs.** A comma-separated list, *web client ID first*, then the iOS
client ID, then the Android one if you did step 2. The web id is what the native
SDK sends as its server client id; the others are the audiences tokens are
actually issued to, and Supabase rejects any token whose `aud` is not in this
list. Leave the existing **Client Secret** alone — that belongs to the browser
flow, which stays as the fallback.

**Skip nonce check.** Turn it **on**. Supabase validates nonces by default, and
the native iOS sheet does not produce one, so sign-in fails with an opaque nonce
error until this is enabled. Supabase's own iOS guidance says to enable it.

Do this on **both** projects, separately — the dashboard has no shared config:

- staging `wfboznibkhsfxteejxco` — what `.env` and TestFlight point at, and the
  project named in the dialog you saw
- production `uhiqjbxqhhxjxnbznocc` — `.env.production`

**The trap worth checking.** The browser flow already works, which means a
Google web OAuth client already exists somewhere and is configured in these
dashboards. If that client lives in a *different* Google Cloud project than
`parse-6b0c2`, step 1 created a second, unrelated web client. That is fine —
list both IDs — but the one you put in `.env` must be the one from
`parse-6b0c2`, because that is the project the native SDK reads its iOS client
from. Mixing the two is the single most likely way this ends in a token whose
audience Supabase will not accept.

## 5. Set the environment variable

Add the step 1 web client ID to `.env` and `.env.staging`, and the production
one to `.env.production`:

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
```

Same value as the first entry of the Supabase **Client IDs** list for that
project. If they disagree, sign-in fails at `signInWithIdToken` with an audience
error.

## 6. Rebuild

```bash
npm run prebuild:ios && npm run ios
```

`ios/` and `android/` are gitignored, so there is no native diff to review — the
URL scheme is injected into `Info.plist` at prebuild from the plist's
`REVERSED_CLIENT_ID`. A rebuild is mandatory: the config plugin's work does not
reach an existing binary, and the JS gate alone would send users into a native
sheet with nowhere to return to.

## 7. Verify on a device

1. Tap **Sign in with Google**. The native account sheet appears, listing
   accounts already on the device. **No consent dialog, no browser.** That alone
   confirms both gates armed.
2. Sign in. You land in the app with the right name and avatar — the Google
   identity mapping in `identity.ts` is unchanged, so this should behave exactly
   as before.
3. Sign out, tap Google again, and check you are *offered the account picker*
   rather than being signed straight back in. `signInWithGoogleNatively` calls
   `GoogleSignin.signOut()` first for this reason; without it, "sign in as
   someone else" is impossible after the first sign-in.
4. Dismiss the sheet without choosing. You should land back on the sign-in
   screen with no error alert.

If step 1 still shows the old browser dialog, the runtime gate is off — the env
var did not reach the build. Restart Metro; `EXPO_PUBLIC_*` values are inlined at
bundle time, not read at runtime.

---

## Afterwards: delete the browser flow

`signInWithGoogleViaBrowser` is kept only so that a build without the OAuth
clients still has a working Google sign-in. Once the native path is confirmed on
a real device **and** both Supabase projects are configured, it and its
supporting machinery should go:

- `signInWithGoogleViaBrowser`, and the `signInWithGoogle` dispatcher collapses
  into a direct call
- `oauthCallbackAtRef` and the 30-second `callbackSeen` window
- the `result.type === 'cancel'` branch with its double `getSession` re-check —
  the whole reason it exists is that a browser redirect can be swallowed by the
  app's own URL handler, which produced two unreportable incidents. The native
  sheet is in-process, so a cancel is unambiguously a cancel.
- `exchangeOAuthResult`, if the deep-link handler has no other caller by then

That is the real payoff of this change, and it is a separate commit from this
one on purpose: deleting the fallback before the replacement is proven on a
device would leave no way back.
