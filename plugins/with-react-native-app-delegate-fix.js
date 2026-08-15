const { withAppDelegate } = require('@expo/config-plugins');

const legacySourceUrlOverride = `
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }
`;

/**
 * React Native 0.86 always uses the New Architecture, where Expo deliberately
 * obtains the development URL through bundleURL(). Keeping the legacy bridge
 * override makes Xcode 26.1 try to resolve RCTBridge from the prebuilt React
 * framework and prevents the application target from compiling.
 *
 * Apply the workaround during prebuild because the native folders are
 * generated and intentionally excluded from version control.
 */
module.exports = (config) =>
  withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== 'swift') {
      return appDelegateConfig;
    }

    appDelegateConfig.modResults.contents =
      appDelegateConfig.modResults.contents.replace(legacySourceUrlOverride, '');

    return appDelegateConfig;
  });
