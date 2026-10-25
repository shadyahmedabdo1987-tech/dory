/**
 * Dynamic config layered on app.json.
 *
 * Native Firebase (used for App Check attestation) needs the platform config
 * files from the Firebase console. They're optional: when they're missing
 * (Expo Go, CI, a fresh clone) the app builds and runs without App Check.
 *
 * Files can be local (./google-services.json, ./GoogleService-Info.plist) or
 * provided to EAS as file environment variables GOOGLE_SERVICES_JSON /
 * GOOGLE_SERVICE_INFO_PLIST.
 */
const fs = require('fs');

function firstExisting(...paths) {
  return paths.find((p) => p && fs.existsSync(p));
}

module.exports = ({ config }) => {
  const androidFile = firstExisting(process.env.GOOGLE_SERVICES_JSON, './google-services.json');
  const iosFile = firstExisting(process.env.GOOGLE_SERVICE_INFO_PLIST, './GoogleService-Info.plist');
  const nativeFirebase = Boolean(androidFile || iosFile);

  const plugins = [...(config.plugins ?? [])];
  if (nativeFirebase) {
    plugins.push('@react-native-firebase/app', '@react-native-firebase/app-check');
  }
  // Small APK: ML Kit OCR from Google Play services instead of bundled models.
  plugins.push('./plugins/withMlkitUnbundled');
  plugins.push([
    'expo-build-properties',
    {
      // Smaller, faster release builds (R8 code shrinking + unused resource removal).
      android: {
        enableMinifyInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        // Optional/compile-only classes referenced by dependencies; safe to ignore at runtime.
        extraProguardRules: [
          '-dontwarn com.google.errorprone.annotations.**',
          '-dontwarn javax.annotation.**',
          '-dontwarn org.conscrypt.**',
          '-dontwarn org.bouncycastle.**',
          '-dontwarn org.openjsse.**',
          '-dontwarn com.google.firebase.**',
          '-dontwarn io.invertase.firebase.**',
          '-keep class com.swmansion.** { *; }',
          '-keep class expo.modules.** { *; }',
        ].join('\n'),
      },
      // ML Kit text recognition needs iOS 15.5+.
      ios: { deploymentTarget: '15.5', ...(nativeFirebase ? { useFrameworks: 'static' } : {}) },
    },
  ]);

  return {
    ...config,
    plugins,
    // FCM (push notifications) needs the Android Firebase config. The copy in
    // config/ is used for push only; native Firebase (App Check) stays off
    // unless a root/EAS google-services.json is provided.
    android: {
      ...config.android,
      // Google Play needs a bigger number for every upload: 2.35.0 → 23500.
      versionCode: (() => {
        const [a, b, c] = String(config.version).split('.').map((n) => parseInt(n, 10) || 0);
        return a * 10000 + b * 100 + c;
      })(),
      googleServicesFile: androidFile || (fs.existsSync('./config/google-services.json') ? './config/google-services.json' : undefined),
    },
    ios: {
      ...config.ios,
      // App Store Connect needs a bigger build number for every upload (set by the CI run).
      ...(process.env.IOS_BUILD_NUMBER && { buildNumber: String(process.env.IOS_BUILD_NUMBER) }),
      ...(iosFile && { googleServicesFile: iosFile }),
    },
    extra: {
      ...config.extra,
      // Expo project (push notification tokens). Env overrides for other projects.
      eas: { projectId: process.env.EAS_PROJECT_ID || 'd58ac821-2af9-433a-9cda-c16854d3db91' },
    },
  };
};
