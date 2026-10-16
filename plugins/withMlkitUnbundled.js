/**
 * Keeps the APK small: @react-native-ml-kit/text-recognition bundles ML Kit's
 * OCR models (~14 MB). Swap them for the Google Play services variants (same
 * API, models downloaded by Play services on the phone) and ask Play services
 * to fetch the OCR model when the app is installed.
 */
const { withAppBuildGradle, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SCRIPTS = ['', '-chinese', '-devanagari', '-japanese', '-korean'];
const MARK = '// dory: unbundled ML Kit OCR';

function withGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARK)) return cfg;
    const excludes = SCRIPTS.map((s) => `    exclude group: 'com.google.mlkit', module: 'text-recognition${s}'`).join('\n');
    const deps = [
      "    implementation 'com.google.android.gms:play-services-mlkit-text-recognition:19.0.1'",
      ...SCRIPTS.slice(1).map((s) => `    implementation 'com.google.android.gms:play-services-mlkit-text-recognition${s}:16.0.1'`),
    ].join('\n');
    cfg.modResults.contents += `\n${MARK}\nconfigurations.all {\n${excludes}\n}\ndependencies {\n${deps}\n}\n`;
    return cfg;
  });
}

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.mlkit.vision.DEPENDENCIES', 'ocr');
    return cfg;
  });
}

module.exports = (config) => withManifest(withGradle(config));
