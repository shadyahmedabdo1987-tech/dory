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
    plugins.push(
      '@react-native-firebase/app',
      '@react-native-firebase/app-check',
      ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
    );
  }

  return {
    ...config,
    plugins,
    android: { ...config.android, ...(androidFile && { googleServicesFile: androidFile }) },
    ios: { ...config.ios, ...(iosFile && { googleServicesFile: iosFile }) },
    extra: {
      ...config.extra,
      ...(process.env.EAS_PROJECT_ID && { eas: { projectId: process.env.EAS_PROJECT_ID } }),
    },
  };
};
