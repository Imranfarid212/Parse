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

export default ({ config }: ConfigContext): ExpoConfig => {
  const firebasePlugins: NonNullable<ExpoConfig['plugins']> = firebaseReady
    ? [
        '@react-native-firebase/app',
        '@react-native-firebase/crashlytics',
        '@react-native-firebase/analytics',
        // React Native Firebase requires dynamic frameworks on RN 0.75+, and
        // explicitly warns against combining its default SPM mode with static
        // ones. This is the only reason expo-build-properties is here.
        ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
      ]
    : [];

  if (!firebaseReady && process.env.EXPO_PUBLIC_ENV === 'production') {
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
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.devicecheck.appattest-environment':
          process.env.EXPO_PUBLIC_ENV === 'production' ? 'production' : 'development',
      },
    },
  };
};
