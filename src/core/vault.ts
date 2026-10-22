/**
 * Organizer password recovery without email, SMS or a paid server.
 *
 * At sign-up the app makes a secret recovery code. That code is the password of a
 * second, hidden login whose address is derived from (number + code), so only someone
 * with the code can sign into it; Firebase limits how fast anyone can guess.
 * The organizer's password is stored encrypted with the code, in `vault/{phone}`, and the
 * security rules let only that hidden login (or the organizer) read it.
 */
import { sha256 } from './hash.ts';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const RECOVERY_DOMAIN = '@phone.dory.app';

/** 12 characters from 31 symbols (~59 bits), shown as XXXX-XXXX-XXXX. */
export function makeRecoveryCode(randomBytes: (n: number) => Uint8Array): string {
  let s = '';
  while (s.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < 248 && s.length < 12) s += ALPHABET[b % 31]; // 248 = 8×31, no bias
    }
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export const cleanRecoveryCode = (c: string) =>
  c
    .toUpperCase()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^A-Z0-9]/g, '');

export const isRecoveryCode = (c: string) => {
  const s = cleanRecoveryCode(c);
  return s.length === 12 && [...s].every((ch) => ALPHABET.includes(ch));
};

/** The hidden login for (number, code). */
export function recoveryLogin(phone: string, code: string): { email: string; password: string } {
  const c = cleanRecoveryCode(code);
  return { email: `r${sha256(`dory:rec:v1:${phone}:${c}`).slice(0, 32)}${RECOVERY_DOMAIN}`, password: `dory-${c}` };
}

function keyFor(code: string, salt: string): string {
  let k = sha256(`dory:vault:v1:${salt}:${cleanRecoveryCode(code)}`);
  for (let i = 0; i < 2000; i++) k = sha256(`${k}:${salt}`);
  return k;
}

function stream(key: string, length: number): number[] {
  const out: number[] = [];
  for (let block = 0; out.length < length; block++) {
    const h = sha256(`${key}:${block}`);
    for (let i = 0; i < 64 && out.length < length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  }
  return out;
}

const hex = (n: number) => n.toString(16).padStart(2, '0');

/** Encrypts the password with the code. */
export function sealPassword(password: string, code: string, salt: string): string {
  const key = keyFor(code, salt);
  const plain = encodeURIComponent(password);
  const ks = stream(key, plain.length);
  const body = [...plain].map((ch, i) => hex(ch.charCodeAt(0) ^ ks[i])).join('');
  return `${body}.${sha256(`${key}:tag:${body}`).slice(0, 32)}`;
}

/** The password back, or null when the code is wrong / the box was changed. */
export function openPassword(box: string, code: string, salt: string): string | null {
  const [body, tag] = box.split('.');
  if (!body || !tag) return null;
  const key = keyFor(code, salt);
  if (sha256(`${key}:tag:${body}`).slice(0, 32) !== tag) return null;
  const ks = stream(key, body.length / 2);
  let plain = '';
  for (let i = 0; i < body.length / 2; i++) plain += String.fromCharCode(parseInt(body.slice(i * 2, i * 2 + 2), 16) ^ ks[i]);
  try {
    return decodeURIComponent(plain);
  } catch {
    return null;
  }
}
