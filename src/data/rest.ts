/**
 * Direct HTTPS calls to Firestore for the few steps that must never hang:
 * joining / signing back in, choosing a password and signing out.
 *
 * The SDK's streaming connection can stall for a long time on some phones
 * (right after switching accounts, or on flaky networks), and a write queued
 * there looks done on the phone while the server never got it. A plain
 * request either answers or fails within seconds, and the same security rules
 * apply to it.
 */
import { AppError, MESSAGES } from './errors';
import { firebaseAuth } from './firebase';
import { quickAppCheckToken } from './appCheck';

const PROJECT = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;

type Value =
  | { stringValue: string }
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number };

export type Fields = Record<string, unknown>;

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

function fromValue(v: Record<string, unknown>): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  return undefined;
}

async function headers(): Promise<Record<string, string>> {
  const user = firebaseAuth().currentUser;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) h.Authorization = `Bearer ${await user.getIdToken()}`;
  const appCheck = await quickAppCheckToken();
  if (appCheck) h['X-Firebase-AppCheck'] = appCheck;
  return h;
}

async function request(url: string, init: RequestInit, ms = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: await headers(), signal: controller.signal });
  } catch {
    throw new AppError('dory/offline-timeout', MESSAGES['dory/offline-timeout']);
  } finally {
    clearTimeout(timer);
  }
}

function fail(res: Response): never {
  if (res.status === 403) throw new AppError('permission-denied', 'permission-denied');
  if (res.status === 404) throw new AppError('not-found', 'not-found');
  throw new AppError('unavailable', MESSAGES['dory/offline-timeout']);
}

/** One document's fields, or null when it doesn't exist. */
export async function restGet(path: string): Promise<Fields | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await request(`${BASE}/${path}`, { method: 'GET' });
    if (res.status === 404) return null;
    if (res.ok) {
      const body = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
      const out: Fields = {};
      Object.entries(body.fields ?? {}).forEach(([k, v]) => (out[k] = fromValue(v)));
      return out;
    }
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    fail(res);
  }
}

export type RestWrite =
  /** Replace the whole document; `serverTime` fields get the request time. */
  | { set: string; data: Fields; serverTime?: string[] }
  /** Change only these fields of an existing document. */
  | { update: string; data: Fields }
  | { delete: string };

/** All writes succeed together or none do — the same as a batch. */
export async function restCommit(writes: RestWrite[]): Promise<void> {
  const body = {
    writes: writes.map((w) => {
      if ('delete' in w) return { delete: `${ROOT}/${w.delete}` };
      const fields = Object.fromEntries(Object.entries(w.data).map(([k, v]) => [k, toValue(v)]));
      if ('update' in w) {
        return {
          update: { name: `${ROOT}/${w.update}`, fields },
          updateMask: { fieldPaths: Object.keys(w.data) },
          currentDocument: { exists: true },
        };
      }
      return {
        update: { name: `${ROOT}/${w.set}`, fields },
        ...(w.serverTime?.length
          ? { updateTransforms: w.serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }
          : {}),
      };
    }),
  };
  const res = await request(`${BASE}:commit`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) fail(res);
}
