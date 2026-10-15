/**
 * Native Firebase (App Check attestation) is only linked when the platform
 * config files exist — see app.config.js. Without them (sideload/test builds)
 * the native modules are left out so the app never crashes at startup.
 */
const fs = require('fs');

const hasAndroid = Boolean(process.env.GOOGLE_SERVICES_JSON) || fs.existsSync(__dirname + '/google-services.json');
const hasIos = Boolean(process.env.GOOGLE_SERVICE_INFO_PLIST) || fs.existsSync(__dirname + '/GoogleService-Info.plist');

const off = (android, ios) => ({ platforms: { ...(android ? {} : { android: null }), ...(ios ? {} : { ios: null }) } });

module.exports = {
  dependencies:
    hasAndroid && hasIos
      ? {}
      : {
          '@react-native-firebase/app': off(hasAndroid, hasIos),
          '@react-native-firebase/app-check': off(hasAndroid, hasIos),
        },
};
