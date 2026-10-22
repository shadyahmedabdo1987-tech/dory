import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import { setupAppCheck } from './appCheck';

/**
 * Firebase config is read from EXPO_PUBLIC_* variables (see .env.example).
 * They are compiled into the app, so every user who installs the store build
 * talks to the same production project — no setup on their side.
 */
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST; // e.g. "192.168.1.10"

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function init() {
  if (app) return;
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured. Copy .env.example to .env and fill in your project keys.');
  }
  const isFresh = getApps().length === 0;
  app = isFresh ? initializeApp(config) : getApp();

  if (isFresh) {
    // App Check must be initialized before Auth/Firestore start sending requests.
    if (!emulatorHost) setupAppCheck(app);
    // Keep the session across app restarts (members stay signed in).
    auth =
      Platform.OS === 'web'
        ? getAuth(app)
        : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    db = createFirestore(app);
    if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  } else {
    auth = getAuth(app);
    db = getFirestore(app);
  }
}

export function firebaseApp(): FirebaseApp {
  init();
  return app!;
}

export function firebaseAuth(): Auth {
  init();
  return auth!;
}

export function firestore(): Firestore {
  init();
  return db!;
}

function createFirestore(a: FirebaseApp): Firestore {
  const instance = initializeFirestore(a, {
    // Silently drop `undefined` fields instead of throwing.
    ignoreUndefinedProperties: true,
    // Works around proxies / carrier networks that break WebChannel streaming.
    experimentalAutoDetectLongPolling: true,
  });
  if (emulatorHost) connectFirestoreEmulator(instance, emulatorHost, 8080);
  return instance;
}

// ---------------------------------------------------------------------------
// Self-healing: a stuck Firestore client is replaced with a fresh one — the
// same thing an app restart does — and every live hook re-subscribes.
// ---------------------------------------------------------------------------

let epoch = 0;
let resetting: Promise<void> | undefined;
const epochListeners = new Set<(epoch: number) => void>();

export function firestoreEpoch(): number {
  return epoch;
}

export function onFirestoreReset(listener: (epoch: number) => void): () => void {
  epochListeners.add(listener);
  return () => epochListeners.delete(listener);
}

export function resetFirestore(): Promise<void> {
  if (resetting) return resetting;
  resetting = (async () => {
    init();
    const old = db!;
    try {
      await Promise.race([terminate(old), new Promise((r) => setTimeout(r, 4000))]);
    } catch {
      // A broken client may fail to shut down cleanly; replace it anyway.
    }
    try {
      db = createFirestore(app!);
    } catch {
      // initializeFirestore refuses if the old one never finished terminating.
      db = getFirestore(app!);
    }
    epoch++;
    epochListeners.forEach((l) => l(epoch));
  })().finally(() => {
    resetting = undefined;
  });
  return resetting;
}
