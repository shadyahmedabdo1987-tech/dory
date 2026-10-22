/**
 * "Forgot my password" on the phone I already use: the password is kept in the phone's
 * secure storage (Android Keystore / iOS Keychain) and only comes out after the
 * fingerprint / face — or the phone's own lock code or pattern on phones without one.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { normalizePhone, sha256 } from '@/core';

export type SavedLogin = { kind: 'admin'; phone: string } | { kind: 'member'; cid: string; phone: string };

function keyOf(l: SavedLogin): string | null {
  const p = normalizePhone(l.phone);
  if (!p) return null;
  const id = l.kind === 'admin' ? `admin:${p}` : `member:${l.cid}:${p}`;
  return `dory_pw_${sha256(id).slice(0, 24)}`;
}

export async function rememberPassword(l: SavedLogin, password: string): Promise<void> {
  const key = keyOf(l);
  if (!key || !password) return;
  await SecureStore.setItemAsync(key, password).catch(() => {});
}

export async function hasSavedPassword(l: SavedLogin): Promise<boolean> {
  const key = keyOf(l);
  if (!key) return false;
  return !!(await SecureStore.getItemAsync(key).catch(() => null));
}

export async function forgetPassword(l: SavedLogin): Promise<void> {
  const key = keyOf(l);
  if (key) await SecureStore.deleteItemAsync(key).catch(() => {});
}

export class UnlockError extends Error {}

/**
 * Asks for the fingerprint / face or the phone's lock code, then returns the saved password.
 * Throws UnlockError (with an Arabic message) when it can't.
 */
export async function unlockSavedPassword(l: SavedLogin, prompt = 'أكّد إنك صاحب الموبايل'): Promise<string> {
  const key = keyOf(l);
  const saved = key ? await SecureStore.getItemAsync(key).catch(() => null) : null;
  if (!saved) throw new UnlockError('الرقم السري مش محفوظ على الموبايل ده.');
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    throw new UnlockError('موبايلك مفيهوش قفل. اعمل قفل للشاشة (رقم سري أو نمط أو بصمة) من إعدادات الموبايل، وجرّب تاني.');
  }
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'إلغاء',
    disableDeviceFallback: false, // phones without a fingerprint use their lock code / pattern
  }).catch(() => ({ success: false as const, error: 'unknown' }));
  if (!r.success) throw new UnlockError('ما اتأكدناش إنك صاحب الموبايل. جرّب تاني.');
  return saved;
}
