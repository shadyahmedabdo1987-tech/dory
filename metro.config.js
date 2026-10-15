// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The Firebase JS SDK ships .cjs files and relies on the "react-native" field
// rather than package exports. Without these two lines Auth fails at runtime
// with "Component auth has not been registered yet".
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
