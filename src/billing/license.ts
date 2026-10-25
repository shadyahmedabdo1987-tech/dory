/**
 * Free 30-day trial, then a one-time purchase that unlocks the app for good.
 *
 * - The full version is one non-consumable in-app product on both stores.
 * - iPhone: the trial is Apple's approved way — a free (price 0) non-consumable
 *   "30-day trial" item. Its purchase date (kept by Apple on the person's Apple ID)
 *   is when the trial started, so deleting and reinstalling doesn't restart it.
 * - Android: the trial starts the first time the app opens on the phone and is kept on the
 *   server under the phone's id, so reinstalling doesn't restart it either.
 */
import * as Application from 'expo-application';
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { ensureSignedIn } from '@/data/auth';
import { restCommit, restGet } from '@/data/rest';
import { readPrefsSync, writePrefs } from '@/ui/prefs';

export const FULL_SKU = 'com.alabdo.dory.full';
export const TRIAL_SKU_IOS = 'com.alabdo.dory.trial30';
export const TRIAL_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type License =
  | { state: 'checking' }
  | { state: 'full' }
  | { state: 'trial'; daysLeft: number }
  /** iPhone, first run: the free trial still has to be started (a free Apple "purchase"). */
  | { state: 'start-trial' }
  | { state: 'expired' };

type Store = { license: License; price: string | null };

let store: Store = { license: initial(), price: null };
const listeners = new Set<(s: Store) => void>();
function set(next: Partial<Store>) {
  store = { ...store, ...next };
  listeners.forEach((l) => l(store));
}

function fromCache(): License | null {
  const c = readPrefsSync().license;
  if (c?.full) return { state: 'full' };
  if (c?.trialStart) return trialFrom(c.trialStart);
  return null;
}

function initial(): License {
  if (Platform.OS === 'web') return { state: 'full' };
  return fromCache() ?? { state: 'checking' };
}

function trialFrom(start: number): License {
  const left = Math.ceil((start + TRIAL_DAYS * DAY - Date.now()) / DAY);
  return left > 0 ? { state: 'trial', daysLeft: left } : { state: 'expired' };
}

function remember(full: boolean, trialStart?: number) {
  const prev = readPrefsSync().license ?? {};
  writePrefs({ license: { full: full || !!prev.full, trialStart: trialStart ?? prev.trialStart } });
}

const ownsFull = (ps: Purchase[]) => ps.some((p) => p.productId === FULL_SKU);

/** Android: when the trial started on this phone (created on first run, kept on the server). */
async function androidTrialStart(): Promise<number | null> {
  const id = Application.getAndroidId();
  if (!id) return null;
  await ensureSignedIn();
  const path = `trials/a-${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
  let doc = await restGet(path);
  if (!doc) {
    await restCommit([{ set: path, data: { platform: 'android' }, serverTime: ['at'] }]).catch(() => {});
    doc = await restGet(path);
  }
  const at = doc?.at;
  const t = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

let connected: Promise<unknown> | null = null;
function connect() {
  connected ??= initConnection().catch((e) => {
    connected = null;
    throw e;
  });
  return connected;
}

/** Checks the stores (and the server for the Android trial) and updates the license. */
export async function refreshLicense(): Promise<License> {
  if (Platform.OS === 'web') return store.license;
  try {
    await connect();
    const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    if (ownsFull(purchases)) {
      remember(true);
      set({ license: { state: 'full' } });
      return store.license;
    }
    fetchProducts({ skus: [FULL_SKU], type: 'in-app' })
      .then((ps) => set({ price: (ps?.[0] as { displayPrice?: string } | undefined)?.displayPrice ?? null }))
      .catch(() => {});
    let start: number | null = null;
    if (Platform.OS === 'ios') {
      const t = purchases.find((p) => p.productId === TRIAL_SKU_IOS);
      start = t ? t.transactionDate : null;
    } else {
      start = await androidTrialStart();
    }
    if (start) {
      remember(false, start);
      set({ license: trialFrom(start) });
    } else {
      set({ license: Platform.OS === 'ios' ? { state: 'start-trial' } : fromCache() ?? { state: 'trial', daysLeft: TRIAL_DAYS } });
    }
  } catch {
    // Store or network unreachable: keep what we knew; never lock someone out because they're offline.
    set({ license: fromCache() ?? { state: 'trial', daysLeft: TRIAL_DAYS } });
  }
  return store.license;
}

async function buy(sku: string) {
  await connect();
  await requestPurchase({ request: { apple: { sku }, google: { skus: [sku] } }, type: 'in-app' });
}

/** iPhone: starts the free 30-day trial (Apple shows its own confirmation, price 0). */
export const startTrial = () => buy(TRIAL_SKU_IOS);
export const buyFull = () => buy(FULL_SKU);
export const restorePurchases = () => refreshLicense();

/** Finishes every completed purchase and refreshes the license. Call once at startup. */
export function listenToPurchases(onError: (message: string) => void) {
  if (Platform.OS === 'web') return () => {};
  const a = purchaseUpdatedListener(async (p: Purchase) => {
    try {
      await finishTransaction({ purchase: p, isConsumable: false });
    } catch {
      // already finished
    }
    if (p.productId === FULL_SKU) remember(true);
    if (p.productId === TRIAL_SKU_IOS) remember(false, p.transactionDate || Date.now());
    refreshLicense();
  });
  const b = purchaseErrorListener((e: { code?: string; message?: string }) => {
    if (String(e.code ?? '').toLowerCase().includes('cancel')) return;
    onError('الشراء ما كملش. جرّب تاني، أو اتأكد من حسابك في المتجر.');
  });
  refreshLicense();
  return () => {
    a.remove();
    b.remove();
  };
}

export function useLicense(): Store {
  const [s, setS] = useState(store);
  useEffect(() => {
    listeners.add(setS);
    setS(store);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
