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
import { restCommit, restGet } from './rest';
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
  if (!phone) throw new AppError('dory/bad-phone', 'رقم الموبايل مكتوب غلط.');
  return `${phone}${PHONE_DOMAIN}`;
}
/** The number an organizer signs in with (or null for an older email account). */
export function phoneOfLogin(email: string | null | undefined): string | null {
  if (!email || !email.endsWith(PHONE_DOMAIN)) return null;
  const d = email.slice(0, -PHONE_DOMAIN.length);
  return d.startsWith('20') ? `0${d.slice(2)}` : d;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/**
 * The organizer signs in with the mobile number; the email (asked once at sign-up) is only
 * where the "change / forgot password" link goes. `adminLogins/{phone}` maps one to the other.
 */
async function adminEmailOf(phone: string): Promise<string | null> {
  await ensureSignedIn(); // the lookup needs a (silent) sign-in
  const f = await restGet(`adminLogins/${phone}`).catch(() => null);
  return typeof f?.email === 'string' ? f.email : null;
}

/**
 * Runs an organizer sign-up / sign-in step. If it fails and the only session is the silent
 * one made just for the number lookup, drop it — a failed attempt leaves nobody signed in.
 */
async function cleanOnFail<T>(fn: () => Promise<T>, alwaysClean = false): Promise<T> {
  const auth = firebaseAuth();
  const before = auth.currentUser?.uid ?? null;
  const drop = async () => {
    const u = auth.currentUser;
    if (!before && u?.isAnonymous) await fbSignOut(auth).catch(() => {});
  };
  try {
    const r = await fn();
    if (alwaysClean) await drop();
    return r;
  } catch (e) {
    await drop();
    throw e;
  }
}

function phoneOrThrow(raw: string): string {
  const p = normalizePhone(raw.trim());
  if (!p) throw new AppError('dory/bad-phone', 'رقم الموبايل مكتوب غلط.');
  return p;
}

async function signUpAdminInner(name: string, rawPhone: string, rawEmail: string, password: string): Promise<User> {
  const phone = phoneOrThrow(rawPhone);
  const email = rawEmail.trim().toLowerCase();
  if (!isEmail(email)) throw new AppError('auth/invalid-email', 'الإيميل مكتوب غلط.');
  if (await adminEmailOf(phone)) throw new AppError('auth/phone-in-use', 'الرقم ده عليه حساب بالفعل. سجّل دخول.');
  const auth = firebaseAuth();
  const current = auth.currentUser;
  let cred;
  try {
    // A member who joined anonymously keeps their circles by upgrading in place.
    cred = current?.isAnonymous
      ? await linkWithCredential(current, EmailAuthProvider.credential(email, password))
      : await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code !== 'auth/email-already-in-use' && code !== 'auth/credential-already-in-use') throw e;
    // The email already has an (older) account: if the password matches, it's theirs — use it.
    try {
      cred = await signInWithEmailAndPassword(auth, email, password);
    } catch {
      throw new AppError(
        'dory/email-taken',
        'الإيميل ده عليه حساب قديم برقم سري تاني. اكتب نفس الرقم السري القديم بتاعه، أو استخدم إيميل تاني.',
      );
    }
  }
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  // Refresh the ID token so security rules see the new sign-in provider.
  await cred.user.getIdToken(true);
  await restCommit([{ set: `adminLogins/${phone}`, data: { uid: cred.user.uid, email } }]);
  return cred.user;
}

async function signInAdminInner(rawPhone: string, password: string): Promise<User> {
  const phone = phoneOrThrow(rawPhone);
  const email = await adminEmailOf(phone);
  // Older accounts (made with the number only) sign in with the number-shaped login.
  const cred = await signInWithEmailAndPassword(firebaseAuth(), email ?? loginFor(phone), password);
  return cred.user;
}

/** Forgot password: the email must be the one this number registered with. */
async function sendAdminResetLinkInner(rawPhone: string, rawEmail: string): Promise<void> {
  const phone = phoneOrThrow(rawPhone);
  const email = rawEmail.trim().toLowerCase();
  const saved = await adminEmailOf(phone);
  if (!saved) throw new AppError('auth/user-not-found', 'مفيش حساب صاحب جمعية بالرقم ده.');
  if (saved !== email) throw new AppError('auth/wrong-email', 'الإيميل ده مش هو اللي متسجّل بالرقم ده.');
  await sendPasswordResetEmail(firebaseAuth(), email);
}

export const signUpAdmin = (name: string, phone: string, email: string, password: string) =>
  cleanOnFail(() => signUpAdminInner(name, phone, email, password));
export const signInAdmin = (phone: string, password: string) => cleanOnFail(() => signInAdminInner(phone, password));
export const sendAdminResetLink = (phone: string, email: string) => cleanOnFail(() => sendAdminResetLinkInner(phone, email), true);

/** Signed in: send the change-password link to my own email. Returns where it went. */
export async function sendMyResetLink(): Promise<string> {
  const email = firebaseAuth().currentUser?.email;
  if (!email || email.endsWith(PHONE_DOMAIN)) throw new AppError('auth/no-email', 'الحساب ده مفيهوش إيميل.');
  await sendPasswordResetEmail(firebaseAuth(), email);
  return email;
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
