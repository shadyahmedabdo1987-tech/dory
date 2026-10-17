import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { watchMyJoin } from './circles';
import { useFirestoreEpoch } from './hooks';

/**
 * Join requests this device sent and that the admin hasn't decided yet.
 * Kept on the device so the home screen can show "waiting for approval".
 */
export interface PendingJoin {
  cid: string;
  circleName: string;
  name: string;
}

const KEY = 'dory/pending-joins';
const listeners = new Set<(items: PendingJoin[]) => void>();
let cache: PendingJoin[] | undefined;

async function load(): Promise<PendingJoin[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as PendingJoin[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(items: PendingJoin[]) {
  cache = items;
  listeners.forEach((l) => l(items));
  await AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

export async function addPendingJoin(item: PendingJoin) {
  const items = await load();
  await save([...items.filter((i) => i.cid !== item.cid), item]);
}

export async function removePendingJoin(cid: string) {
  const items = await load();
  await save(items.filter((i) => i.cid !== cid));
}

/** On sign-out: forget requests sent from this phone. */
export async function clearPendingJoins() {
  await save([]);
}

export function usePendingJoins(): PendingJoin[] {
  const [items, setItems] = useState<PendingJoin[]>(cache ?? []);
  useEffect(() => {
    load().then(setItems);
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  return items;
}

/** Live status of my request: pending → approved (now a member) or gone (rejected/withdrawn). */
export function useJoinStatus(cid: string | undefined, uid: string | undefined) {
  const [status, setStatus] = useState<'loading' | 'pending' | 'approved' | 'gone'>('loading');
  const epoch = useFirestoreEpoch();
  useEffect(() => {
    if (!cid || !uid) return;
    setStatus('loading');
    return watchMyJoin(cid, uid, setStatus);
  }, [cid, uid, epoch]);
  return status;
}

export function useDismissPending() {
  return useCallback((cid: string) => removePendingJoin(cid), []);
}
