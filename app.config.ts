import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      './plugins/with-react-native-app-delegate-fix',
      './plugins/with-ios-automatic-signing',
    ],
    ios: {
      ...config.ios,
      appleTeamId: config.ios?.appleTeamId ?? 'BN87W82CH8',
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.devicecheck.appattest-environment':
          process.env.EXPO_PUBLIC_ENV === 'production' ? 'production' : 'development',
      },
    },
  };
};
