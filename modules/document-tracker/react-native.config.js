/**
 * iOS-only, on purpose. Live corner detection rides Apple's Vision framework;
 * the Android detector (OpenCV or a TFLite model) is a separate effort, so
 * Android autolinking is disabled outright rather than shipping a Kotlin stub
 * plus the gradle/CMake boilerplate a Nitro module drags onto that platform.
 * The JS side already gates on availability, so Android simply never sees it.
 */
module.exports = {
  dependency: {
    platforms: {
      android: null,
    },
  },
};
