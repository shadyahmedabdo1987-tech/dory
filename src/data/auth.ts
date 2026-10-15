import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';

import { firebaseAuth, isFirebaseConfigured } from './firebase';

export interface Session {
  user: User | null;
  loading: boolean;
  /** Signed in with an email account (can own circles). */
  isAccount: boolean;
}

export function useSession(): Session {
  const [user, setUser] = useState<User | null>(() => (isFirebaseConfigured ? firebaseAuth().currentUser : null));
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading, isAccount: !!user && !user.isAnonymous };
}

export async function signUpAdmin(name: string, email: string, password: string): Promise<User> {
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
  const cred = await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password);
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
}
