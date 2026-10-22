import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  reauthenticateWithCredential,
  updateProfile,
  verifyBeforeUpdateEmail,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';

import { normalizePhone } from '@/core';

import { AppError } from './errors';
import { firebaseAuth, isFirebaseConfigured, resetFirestore } from './firebase';

export interface Session {
  user: User | null;
  loading: boolean;
  /** Signed in with an email account (can own circles). */
  isAccount: boolean;
  /** Re-render after the profile changed (Firebase doesn't emit an event for that). */
  refresh?: () => void;
}

export function useSession(): Session {
  const [user, setUser] = useState<User | null>(() => (isFirebaseConfigured ? firebaseAuth().currentUser : null));
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading, isAccount: !!user && !user.isAnonymous, refresh: () => setTick((t) => t + 1) };
}

/**
 * "حسابي": change the sign-in email. Firebase emails a link to the new address
 * and switches only after it's opened, so a typo can't lock the owner out.
 */
export async function changeMyEmail(newEmail: string, password: string): Promise<void> {
  const u = firebaseAuth().currentUser;
  if (!u || !u.email) return;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  await verifyBeforeUpdateEmail(u, newEmail.trim());
}

/** "حسابي": change the name shown in the app. */
export async function updateMyName(name: string): Promise<void> {
  const u = firebaseAuth().currentUser;
  if (!u) return;
  await updateProfile(u, { displayName: name.trim().slice(0, 60) });
}

/**
 * The organizer signs in with a mobile number + password. Firebase accounts need
 * an email-shaped login, so the number is turned into one (nothing is ever sent to it).
 */
const PHONE_DOMAIN = '@phone.dory.app';
export function loginFor(idOrPhone: string): string {
  const phone = normalizePhone(idOrPhone.trim());
  if (!phone) throw new AppError('auth/invalid-email', 'رقم الموبايل مكتوب غلط.');
  return `${phone}${PHONE_DOMAIN}`;
}
/** The number an organizer signs in with (or null for an older email account). */
export function phoneOfLogin(email: string | null | undefined): string | null {
  if (!email || !email.endsWith(PHONE_DOMAIN)) return null;
  const d = email.slice(0, -PHONE_DOMAIN.length);
  return d.startsWith('20') ? `0${d.slice(2)}` : d;
}

export async function signUpAdmin(name: string, email: string, password: string): Promise<User> {
  email = loginFor(email);
  const auth = firebaseAuth();
  const current = auth.currentUser;
  // A member who joined anonymously keeps their circles by upgrading in place.
  const cred =
    current?.isAnonymous
      ? await linkWithCredential(current, EmailAuthProvider.credential(email.trim(), password))
      : await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  // Refresh the ID token so security rules see the new sign-in provider.
  await cred.user.getIdToken(true);
  return cred.user;
}

export async function signInAdmin(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(firebaseAuth(), loginFor(email), password);
  return cred.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth(), email.trim());
}

/** Members don't need an account: an anonymous session is enough to join. */
export async function ensureSignedIn(): Promise<User> {
  const auth = firebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(firebaseAuth());
  // Fresh database connection for whoever signs in next — the old one can stay
  // tied to the previous account and hold the next sign-in's writes for a while.
  await resetFirestore().catch(() => {});
}
