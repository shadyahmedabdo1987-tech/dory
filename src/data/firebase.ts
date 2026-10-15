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
    db = initializeFirestore(app, {
      // Silently drop `undefined` fields instead of throwing.
      ignoreUndefinedProperties: true,
      // Works around proxies / carrier networks that break WebChannel streaming.
      experimentalAutoDetectLongPolling: true,
    });
    if (emulatorHost) {
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(db, emulatorHost, 8080);
    }
  } else {
    auth = getAuth(app);
    db = getFirestore(app);
  }
}

export function firebaseAuth(): Auth {
  init();
  return auth!;
}

export function firestore(): Firestore {
  init();
  return db!;
}
