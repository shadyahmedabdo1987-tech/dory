/**
 * The production Firebase project's public client identifiers (same as config/production.env).
 * Not secrets — access is enforced by firestore.rules. Used when a build didn't get the
 * EXPO_PUBLIC_* variables, so a store build can never ship "not connected".
 */
export const PROD_FIREBASE = {
  apiKey: 'AIzaSyAjOAi6NsJjMApA8g6fGmVyYE0o6W88wX0',
  authDomain: 'dory-app-eff88.firebaseapp.com',
  projectId: 'dory-app-eff88',
  storageBucket: 'dory-app-eff88.firebasestorage.app',
  messagingSenderId: '1094369061823',
  appId: '1:1094369061823:web:56e97d270ea0f60c410f0a',
};

export const PROD_APP_CHECK = 'off';
