/**
 * Password recovery for organizers (they sign in with mobile number + password, no email).
 *
 * - issueRecoveryCode (signed-in organizer): makes a new secret code, keeps only its hash,
 *   returns the code once. The app sends it to the organizer's own WhatsApp.
 * - resetPasswordWithCode (anyone): number + code + new password → sets the password and
 *   returns a fresh code (the old one stops working). 5 wrong tries lock the number for 1 hour.
 *
 * Codes live in `recovery/{phone}`, which the security rules close to every app user.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const PHONE_DOMAIN = '@phone.dory.app';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const MAX_FAILS = 5;
const LOCK_MS = 60 * 60 * 1000;

function newCode(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Same rule as the app: Egyptian 01… → 201…, digits only, 8–15 long. */
function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '')
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `20${d.slice(1)}`;
  d = d.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

const cleanCode = (c: unknown) =>
  String(c ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const hashOf = (salt: string, code: string) => createHash('sha256').update(`${salt}:${cleanCode(code)}`).digest('hex');

async function storeNewCode(phone: string, uid: string): Promise<string> {
  const code = newCode();
  const salt = newCode();
  await getFirestore()
    .collection('recovery')
    .doc(phone)
    .set({ uid, salt, hash: hashOf(salt, code), fails: 0, lockedUntil: 0, updatedAt: FieldValue.serverTimestamp() });
  return code;
}

export const issueRecoveryCode = onCall(async (req) => {
  const email = req.auth?.token.email;
  if (!req.auth || !email || !email.endsWith(PHONE_DOMAIN)) {
    throw new HttpsError('permission-denied', 'لازم تكون داخل بحساب صاحب جمعية.');
  }
  const phone = email.slice(0, -PHONE_DOMAIN.length);
  return { code: await storeNewCode(phone, req.auth.uid) };
});

export const resetPasswordWithCode = onCall(async (req) => {
  const phone = normalizePhone(req.data?.phone);
  const code = cleanCode(req.data?.code);
  const password = String(req.data?.password ?? '');
  if (!phone || code.length !== 12) throw new HttpsError('invalid-argument', 'الرقم أو كود الاسترجاع مكتوب غلط.');
  if (password.length < 6) throw new HttpsError('invalid-argument', 'الرقم السري لازم يكون ٦ حروف أو أرقام أو أكتر.');

  const ref = getFirestore().collection('recovery').doc(phone);
  const snap = await ref.get();
  const wrong = new HttpsError('permission-denied', 'الرقم أو كود الاسترجاع غلط.');
  if (!snap.exists) throw wrong;
  const d = snap.data() as { uid: string; salt: string; hash: string; fails?: number; lockedUntil?: number };
  if ((d.lockedUntil ?? 0) > Date.now()) {
    throw new HttpsError('resource-exhausted', 'محاولات غلط كتير. استنى ساعة وجرّب تاني.');
  }
  const ok = timingSafeEqual(Buffer.from(hashOf(d.salt, code)), Buffer.from(d.hash));
  if (!ok) {
    const fails = (d.fails ?? 0) + 1;
    await ref.update({ fails: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    throw wrong;
  }

  // The account must still be this number's organizer account.
  const user = await getAuth().getUser(d.uid);
  if (user.email !== `${phone}${PHONE_DOMAIN}`) throw wrong;
  await getAuth().updateUser(d.uid, { password });
  await getAuth().revokeRefreshTokens(d.uid);
  return { code: await storeNewCode(phone, d.uid) };
});
