const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const FLAG = '$RNFirebaseDisableSPM = true';

/**
 * FirebaseCrashlytics and FirebaseSessions are Swift pods that depend on these
 * three, which ship no module map. Swift cannot import a non-modular pod when
 * everything is built as static libraries, so pod install refuses outright.
 *
 * Declared per pod rather than by a global `use_modular_headers!`: the global
 * form changes header visibility for every pod in the graph, and this project
 * has a large one (Skia, Reanimated, Nitro, precompiled React). Three explicit
 * lines change exactly what Firebase needs and nothing else.
 */
const MODULAR = ['GoogleUtilities', 'GoogleDataTransport', 'nanopb'];

/**
 * Resolve the Firebase iOS SDK through CocoaPods instead of Swift Package
 * Manager.
 *
 * React Native Firebase v22+ pulls the SDK via SPM by default, and refuses to
 * install under static linkage:
 *
 *   [react-native-firebase] SPM + static linkage is not supported.
 *   firebase-ios-sdk's Swift Package products are automatic libraries, so each
 *   react-native-firebase pod that resolves Firebase via SPM embeds its own
 *   copy, and those copies collide as duplicate symbols.
 *
 * Its suggested fix is dynamic linkage, which this project cannot take: it uses
 * Expo's precompiled React Native modules (EXPO_USE_PRECOMPILED_MODULES, with
 * React-Core-prebuilt and ReactNativeDependencies), and those do not produce a
 * React.framework. Setting `useFrameworks: dynamic` linked every pod against a
 * framework that was never built and failed with
 * `ld: framework 'React' not found`.
 *
 * So take the other route it offers. Firebase arrives as ordinary CocoaPods
 * static libraries, matching every other dependency here, and precompiled React
 * keeps working. The cost is losing SPM's automatic dSYM upload script, which
 * the CocoaPods integration provides by its own means.
 *
 * A dangerous mod because the flag has to be a Podfile global evaluated before
 * any target block, and no structured Podfile API reaches that position. ios/ is
 * generated and gitignored, so this has to run on every prebuild.
 */
module.exports = (config) =>
  withDangerousMod(config, [
    'ios',
    (dangerousConfig) => {
      const podfile = path.join(dangerousConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');

      if (contents.includes(FLAG)) return dangerousConfig;

      // After `require` lines and before the first target, which is what
      // "before any target block" means in a generated Expo Podfile.
      const anchor = contents.indexOf('\ntarget ');
      if (anchor === -1) {
        throw new Error('[with-rnfirebase-disable-spm] no target block found in the Podfile');
      }

      let next =
        `${contents.slice(0, anchor)}\n\n` +
        `# Injected by plugins/with-rnfirebase-disable-spm.js -- see that file for why.\n` +
        `${FLAG}\n` +
        contents.slice(anchor);

      // Inside the target block, so the declarations apply to its dependency graph.
      const target = next.match(/^target '[^']+' do$/m);
      if (!target) {
        throw new Error('[with-rnfirebase-disable-spm] no target declaration found in the Podfile');
      }
      const after = next.indexOf(target[0]) + target[0].length;
      const pods = MODULAR.map((name) => `  pod '${name}', :modular_headers => true`).join('\n');
      next =
        `${next.slice(0, after)}\n` +
        `  # Injected by plugins/with-rnfirebase-disable-spm.js -- Firebase's Swift pods\n` +
        `  # cannot import these as non-modular static libraries.\n` +
        `${pods}\n` +
        next.slice(after);

      fs.writeFileSync(podfile, next);
      return dangerousConfig;
    },
  ]);
