import type { FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
import { Platform } from 'react-native';
import { PROD_APP_CHECK } from './prodConfig';

/**
 * Firebase App Check: proves requests come from the genuine Dory app
 * (Play Integrity on Android, App Attest / DeviceCheck on iOS), so nobody can
 * hit the database with a script using the public API key.
 *
 * The attestation runs natively through @react-native-firebase/app-check and
 * its tokens are handed to the Firebase JS SDK through a CustomProvider.
 * In Expo Go / web the native module is absent, so App Check stays off there;
 * keep enforcement disabled in the console until store builds are verified.
 */

type NativeAppCheck = {
  newReactNativeFirebaseAppCheckProvider(): {
    configure(options: unknown): void;
  };
  initializeAppCheck(options: { provider: unknown; isTokenAutoRefreshEnabled: boolean }): Promise<void>;
  getToken(forceRefresh?: boolean): Promise<{ token: string }>;
};

let native: NativeAppCheck | null | undefined;
let nativeReady: Promise<NativeAppCheck | null> | undefined;

function loadNative(): Promise<NativeAppCheck | null> {
  if (nativeReady) return nativeReady;
  nativeReady = (async () => {
    if (native !== undefined) return native;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@react-native-firebase/app-check');
      const instance: NativeAppCheck = (mod.default ?? mod)();
      const provider = instance.newReactNativeFirebaseAppCheckProvider();
      provider.configure({
        android: {
          provider: __DEV__ ? 'debug' : 'playIntegrity',
          debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
        apple: {
          provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
          debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
      });
      await instance.initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true });
      native = instance;
    } catch (e) {
      // Not a native build with Firebase config (Expo Go, web, CI) — run without App Check.
      if (!__DEV__) console.warn('App Check unavailable', e);
      native = null;
    }
    return native;
  })();
  return nativeReady;
}

function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 30 * 60 * 1000;
}

export function setupAppCheck(app: FirebaseApp) {
  if (Platform.OS === 'web' || (process.env.EXPO_PUBLIC_APP_CHECK || PROD_APP_CHECK) === 'off') return;
  initializeAppCheck(app, {
    isTokenAutoRefreshEnabled: true,
    provider: new CustomProvider({
      getToken: async () => {
        // Never hold the database back for long: without a token the request
        // still goes out (enforcement stays off until store builds are verified).
        const token = await quickAppCheckToken();
        if (!token) throw new Error('App Check token unavailable');
        return { token, expireTimeMillis: expiryOf(token) };
      },
    }),
  });
}

let lastFailure = 0;
/** A token for direct requests — but never wait more than a moment for it. */
export async function quickAppCheckToken(): Promise<string | null> {
  if (Platform.OS === 'web' || (process.env.EXPO_PUBLIC_APP_CHECK || PROD_APP_CHECK) === 'off') return null;
  if (Date.now() - lastFailure < 10 * 60 * 1000) return null;
  try {
    const nativeAppCheck = await Promise.race([loadNative(), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
    if (!nativeAppCheck) throw new Error('no app check');
    const result = await Promise.race([
      nativeAppCheck.getToken(false),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('slow')), 2500)),
    ]);
    return result.token;
  } catch {
    lastFailure = Date.now();
    return null;
  }
}
