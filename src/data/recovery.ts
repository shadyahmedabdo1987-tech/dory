import { getFunctions, httpsCallable } from 'firebase/functions';

import { normalizePhone } from '@/core';

import { AppError } from './errors';
import { firebaseApp } from './firebase';

const REGION = process.env.EXPO_PUBLIC_FUNCTIONS_REGION || 'europe-west1';
const fns = () => getFunctions(firebaseApp(), REGION);

/** Server error → the Arabic message the function already sent, or a friendly fallback. */
function friendly(e: unknown): never {
  const err = e as { code?: string; message?: string };
  const code = String(err.code ?? '').replace('functions/', '');
  if (['permission-denied', 'invalid-argument', 'resource-exhausted'].includes(code) && err.message) {
    throw new AppError(`recovery/${code}`, err.message);
  }
  if (code === 'not-found' || code === 'internal' || code === 'unavailable') {
    throw new AppError('recovery/unavailable', 'خدمة الاسترجاع مش شغالة دلوقتي. جرّب بعد شوية.');
  }
  throw e;
}

/** New recovery code for the signed-in organizer (the old one stops working). */
export async function issueRecoveryCode(): Promise<string> {
  try {
    const r = await httpsCallable<unknown, { code: string }>(fns(), 'issueRecoveryCode')({});
    return r.data.code;
  } catch (e) {
    friendly(e);
  }
}

/** Number + recovery code + new password → password changed; returns the next code. */
export async function resetPasswordWithCode(phone: string, code: string, password: string): Promise<string> {
  try {
    const r = await httpsCallable<unknown, { code: string }>(fns(), 'resetPasswordWithCode')({
      phone: normalizePhone(phone),
      code,
      password,
    });
    return r.data.code;
  } catch (e) {
    friendly(e);
  }
}

export function recoveryWhatsappText(code: string): string {
  return `🔐 كود استرجاع حساب «دوري»\n⁦${code}⁩\n\nاحتفظ بالرسالة دي ومتبعتهاش لحد. هتحتاج الكود لو نسيت الرقم السري.`;
}
