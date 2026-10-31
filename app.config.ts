import fs from 'node:fs';
import path from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Firebase is configured only when its two credential files are actually
 * present.
 *
 * They are downloaded per-project from the Firebase console and are not in the
 * repository. Listing the plugins unconditionally would make `expo prebuild`
 * fail for anyone who has not fetched them — including CI and a fresh clone —
 * which would turn "monitoring is not set up yet" into "the app does not
 * build". Gating keeps the build green and lights Firebase up the moment the
 * files land, with no further edit here.
 *
 * `monitoring.ts` degrades to no-ops on the same condition, so JS and native
 * agree about whether reporting exists.
 */
const GOOGLE_SERVICES_ANDROID = './google-services.json';
const GOOGLE_SERVICES_IOS = './GoogleService-Info.plist';

const exists = (relative: string) => fs.existsSync(path.resolve(__dirname, relative));
const firebaseReady = exists(GOOGLE_SERVICES_ANDROID) && exists(GOOGLE_SERVICES_IOS);

/**
 * Native Google sign-in needs more than the credential files being present: it
 * needs an OAuth client of its own.
 *
 * The google-signin config plugin, in its Firebase mode, takes the iOS URL
 * scheme straight out of `REVERSED_CLIENT_ID` in the plist. That key appears
 * only once Google is enabled as a sign-in provider in the Firebase console --
 * a plist downloaded for Crashlytics alone does not carry it. Without the
 * scheme the native sheet has nowhere to hand its result back to, so the
 * plugin is gated on the key rather than on the file, and `signInWithGoogle`
 * reads the same condition at runtime to decide which flow to run.
 */
const googleSignInReady =
  firebaseReady &&
  /<key>REVERSED_CLIENT_ID<\/key>/.test(
    fs.readFileSync(path.resolve(__dirname, GOOGLE_SERVICES_IOS), 'utf8'),
  );

export default ({ config }: ConfigContext): ExpoConfig => {
  const isProduction = process.env.EXPO_PUBLIC_ENV === 'production';

  const firebasePlugins: NonNullable<ExpoConfig['plugins']> = firebaseReady
    ? [
        '@react-native-firebase/app',
        '@react-native-firebase/crashlytics',
        '@react-native-firebase/analytics',
        // Deliberately NO expo-build-properties useFrameworks entry.
        //
        // React Native Firebase's docs call for dynamic frameworks, but that
        // applies to the Firebase CocoaPods SDK. Here the SDK resolves through
        // Swift Package Manager -- Podfile.lock carries only the three RNFB
        // wrapper pods -- so the requirement does not apply, and setting it
        // broke the build outright: this project uses Expo's precompiled React
        // Native modules, which do not produce a React.framework, so dynamic
        // linkage fails with "ld: framework 'React' not found".
        //
        // The remaining option RNFirebase offers is to take Firebase from
        // CocoaPods instead of SPM, which is what this plugin does.
        './plugins/with-rnfirebase-disable-spm',
      ]
    : [];

  const googlePlugins: NonNullable<ExpoConfig['plugins']> = googleSignInReady
    ? ['@react-native-google-signin/google-signin']
    : [];

  if (!firebaseReady && isProduction) {
    // Loud in the one case where shipping without crash reporting is a mistake
    // rather than a local convenience.
    console.warn(
      '[app.config] Firebase credential files are missing; the production build will have no crash reporting.',
    );
  }

  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      ...firebasePlugins,
      ...googlePlugins,
      './plugins/with-react-native-app-delegate-fix',
      './plugins/with-ios-automatic-signing',
    ],
    android: {
      ...config.android,
      ...(firebaseReady ? { googleServicesFile: GOOGLE_SERVICES_ANDROID } : {}),
    },
    ios: {
      ...config.ios,
      ...(firebaseReady ? { googleServicesFile: GOOGLE_SERVICES_IOS } : {}),
      appleTeamId: config.ios?.appleTeamId ?? 'BN87W82CH8',
      infoPlist: {
        ...config.ios?.infoPlist,
        /**
         * The local-network ATS exception exists only so a debug build can
         * reach Metro on a `.local` or unqualified hostname. Nothing in a
         * shipped build opens a local connection, and expo-dev-launcher's
         * "Strip Local Network Keys for Release" build phase already removes
         * the `_expo._tcp` Bonjour service and its own usage description from
         * every non-Debug configuration -- but not this, because it is an ATS
         * key rather than a dev-launcher one. Closing it keeps the release
         * binary from declaring a cleartext relaxation it never uses.
         *
         * Declared here rather than left to the prebuild template so the value
         * is deterministic and lives in the repository: `/ios` is generated and
         * untracked, so whatever is in the checked-out plist proves nothing
         * about the next build.
         */
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: !isProduction,
        },
      },
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.devicecheck.appattest-environment': isProduction ? 'production' : 'development',
      },
    },
  };
};
