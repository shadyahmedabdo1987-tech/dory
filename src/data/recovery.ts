/**
 * Organizer password recovery with a one-time recovery code (no email, SMS or paid server).
 * See src/core/vault.ts for how it works.
 */
import * as ExpoCrypto from 'expo-crypto';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';

import { makeRecoveryCode, normalizePhone, openPassword, RECOVERY_DOMAIN, recoveryLogin, sealPassword } from '@/core';

import { quickAppCheckToken } from './appCheck';
import { signInAdmin } from './auth';
import { AppError, MESSAGES } from './errors';
import { firebaseAuth } from './firebase';

const API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const PROJECT = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const WRONG = () => new AppError('recovery/wrong', 'الرقم أو كود الاسترجاع غلط.');

const randomBytes = (n: number) => ExpoCrypto.getRandomBytes(n);

async function call(url: string, init: RequestInit, idToken?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const appCheck = await quickAppCheckToken();
  if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } catch {
    throw new AppError('dory/offline-timeout', MESSAGES['dory/offline-timeout']);
  } finally {
    clearTimeout(timer);
  }
}

/** Firebase Auth REST: works on the hidden login without touching the app's own session. */
async function identity(method: 'signUp' | 'signInWithPassword' | 'delete', body: object) {
  const res = await call(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { idToken?: string; localId?: string; error?: { message?: string } };
  if (res.ok) return data as { idToken: string; localId: string };
  const msg = data.error?.message ?? '';
  if (msg.startsWith('TOO_MANY_ATTEMPTS')) throw new AppError('auth/too-many-requests', MESSAGES['auth/too-many-requests']);
  if (/INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND|USER_DISABLED/.test(msg)) throw WRONG();
  throw new AppError('recovery/failed', 'حصلت مشكلة. جرّب تاني.');
}

const str = (v: string) => ({ stringValue: v });

function myPhone(): { uid: string; phone: string; email: string } {
  const user = firebaseAuth().currentUser;
  const email = user?.email ?? '';
  if (!user || !email.endsWith(RECOVERY_DOMAIN) || email.startsWith('r')) {
    throw new AppError('recovery/no-account', 'لازم تكون داخل بحساب صاحب الجمعية.');
  }
  return { uid: user.uid, phone: email.slice(0, -RECOVERY_DOMAIN.length), email };
}

/** Makes a new recovery code for the signed-in organizer (`password` = their current password). */
export async function createRecoveryCode(password: string): Promise<string> {
  const { uid, phone } = myPhone();
  const code = makeRecoveryCode(randomBytes);
  const hidden = await identity('signUp', recoveryLogin(phone, code));
  const salt = makeRecoveryCode(randomBytes);
  const user = firebaseAuth().currentUser!;
  const res = await call(
    `${DOCS}/vault/${phone}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          owner: str(uid),
          rUid: str(hidden.localId),
          salt: str(salt),
          box: str(sealPassword(password, code, salt)),
          at: { timestampValue: new Date().toISOString() },
        },
      }),
    },
    await user.getIdToken(),
  );
  if (!res.ok) throw new AppError('recovery/failed', 'مقدرتش أحفظ كود الاسترجاع. جرّب تاني من صفحة حسابك.');
  return code;
}

/** Account screen: checks the current password, then makes a new code. */
export async function renewRecoveryCode(password: string): Promise<string> {
  const { email } = myPhone();
  await reauthenticateWithCredential(firebaseAuth().currentUser!, EmailAuthProvider.credential(email, password));
  return createRecoveryCode(password);
}

/** Signed-in organizer changes the password (old one checked); returns a fresh recovery code. */
export async function changeAdminPassword(oldPassword: string, newPassword: string): Promise<string> {
  const { email } = myPhone();
  const user = firebaseAuth().currentUser!;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, oldPassword));
  await updatePassword(user, newPassword);
  return createRecoveryCode(newPassword);
}

/** Forgot password: number + recovery code + new password. Signs in and returns the next code. */
export async function resetPasswordWithCode(rawPhone: string, code: string, newPassword: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw WRONG();
  const hidden = await identity('signInWithPassword', recoveryLogin(phone, code));

  const res = await call(`${DOCS}/vault/${phone}`, { method: 'GET' }, hidden.idToken);
  if (!res.ok) throw WRONG();
  const f = ((await res.json()) as { fields?: Record<string, { stringValue?: string }> }).fields ?? {};
  if (f.rUid?.stringValue !== hidden.localId) throw WRONG();
  const old = openPassword(f.box?.stringValue ?? '', code, f.salt?.stringValue ?? '');
  if (old === null) throw WRONG();

  await signInAdmin(phone, old);
  await updatePassword(firebaseAuth().currentUser!, newPassword);
  const next = await createRecoveryCode(newPassword);
  await identity('delete', { idToken: hidden.idToken }).catch(() => {}); // the used code is gone for good
  return next;
}

export function recoveryWhatsappText(code: string): string {
  return `🔐 كود استرجاع حساب «دوري»\n⁦${code}⁩\n\nاحتفظ بالرسالة دي ومتبعتهاش لحد. هتحتاج الكود لو نسيت الرقم السري.`;
}
