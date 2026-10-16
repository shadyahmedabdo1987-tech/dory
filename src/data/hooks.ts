import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import type { Announcement, PayoutRequest } from '@/core';

import {
  watchAnnouncements,
  watchCircle,
  watchJoinRequests,
  type JoinRequest,
  watchMembership,
  watchMyCircles,
  watchPayouts,
  type CircleRef,
  type CircleSnapshot,
} from './circles';
import { arabicError, retry } from './errors';
import { firestore, firestoreEpoch, onFirestoreReset, resetFirestore } from './firebase';

export type Role = 'admin' | 'member' | 'none';

export interface CircleState {
  loading: boolean;
  error?: string;
  data?: CircleSnapshot;
  role: Role;
  /** The signed-in user's member row (members, or an admin who is also a member). */
  myMemberId?: string;
  notFound: boolean;
}

// ---------------------------------------------------------------------------
// Shared live circle subscriptions
//
// The home card and the circle screen show the same circle. Giving each its own
// Firestore listeners means identical queries get added/removed at the same
// moment on navigation, which can leave the JS SDK's shared watch target stuck
// (endless loading). Instead there's ONE subscription per circle, ref-counted,
// kept alive briefly after the last screen leaves, and restarted by a watchdog
// if it ever stalls.
// ---------------------------------------------------------------------------

const LINGER_MS = 30_000;
const STALL_MS = 12_000;
const INITIAL: CircleState = { loading: true, role: 'none', notFound: false };

interface Entry {
  state: CircleState;
  listeners: Set<(s: CircleState) => void>;
  stop?: () => void;
  linger?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>;
  restarts: number;
}

const entries = new Map<string, Entry>();

function publish(entry: Entry, next: CircleState) {
  entry.state = next;
  if (!next.loading && entry.watchdog) {
    clearTimeout(entry.watchdog);
    entry.watchdog = undefined;
  }
  entry.listeners.forEach((l) => l(next));
}

function start(entry: Entry, cid: string, uid: string) {
  let cancelled = false;
  let unsubCircle: (() => void) | undefined;
  let myMemberId: string | undefined;
  const set = (fn: (s: CircleState) => CircleState) => !cancelled && publish(entry, fn(entry.state));

  const unsubMembership = watchMembership(cid, uid, (memberId) => {
    myMemberId = memberId ?? undefined;
    // A member whose device link was removed loses access to the circle.
    set((s) => ({ ...s, myMemberId, notFound: s.role === 'member' && !memberId ? true : s.notFound }));
  });

  (async () => {
    try {
      // Find out whether we're the admin before subscribing, so only the
      // admin's device asks for members' phone numbers.
      const snap = await retry(() => getDoc(doc(firestore(), 'circles', cid)));
      if (cancelled) return;
      if (!snap.exists()) {
        set(() => ({ loading: false, role: 'none', notFound: true }));
        return;
      }
      const isAdmin = snap.data().adminUid === uid;
      unsubCircle = watchCircle(
        cid,
        { withContacts: isAdmin },
        (data) =>
          set(() => ({
            loading: false,
            data: data ?? undefined,
            notFound: !data,
            role: isAdmin ? 'admin' : 'member',
            myMemberId,
          })),
        (error) => set((s) => ({ ...s, loading: false, error })),
      );
    } catch (e) {
      if (cancelled) return;
      const code = (e as { code?: string }).code;
      set(() => ({ loading: false, role: 'none', notFound: code === 'permission-denied', error: arabicError(e) }));
    }
  })();

  // Watchdog: if nothing arrives in time, tear down and subscribe again (twice at most).
  entry.watchdog = setTimeout(() => {
    entry.watchdog = undefined;
    if (!entry.state.loading || entry.listeners.size === 0) return;
    entry.restarts++;
    if (entry.restarts === 1) {
      restart(entry, cid, uid);
    } else if (entry.restarts === 2) {
      // Still stuck: replace the Firestore client (everything re-subscribes).
      void resetFirestore();
    } else {
      publish(entry, { ...entry.state, loading: false, error: 'التحميل اتأخر. اتأكد من النت ودوس "جرّب تاني".' });
    }
  }, STALL_MS);

  entry.stop = () => {
    cancelled = true;
    if (entry.watchdog) clearTimeout(entry.watchdog);
    entry.watchdog = undefined;
    unsubMembership();
    unsubCircle?.();
  };
}

function restart(entry: Entry, cid: string, uid: string) {
  entry.stop?.();
  // Let the SDK finish removing the old listeners before adding new ones.
  setTimeout(() => {
    if (entry.listeners.size > 0) start(entry, cid, uid);
  }, 300);
}

/** Force a fresh subscription (e.g. from a "try again" button). */
export function reloadCircle(cid: string, uid: string) {
  const entry = entries.get(`${cid}|${uid}`);
  if (!entry) return;
  entry.restarts = 1; // a manual retry escalates straight to a client reset if it stalls again
  publish(entry, { ...entry.state, loading: true, error: undefined });
  void resetFirestore();
}

// After a client reset every shared circle subscription starts over on the new client.
onFirestoreReset(() => {
  entries.forEach((entry, key) => {
    const [cid, uid] = key.split('|');
    entry.stop?.();
    entry.stop = undefined;
    if (entry.listeners.size > 0) start(entry, cid, uid);
    else entries.delete(key);
  });
});

/** Re-runs effects after a Firestore client reset. */
export function useFirestoreEpoch(): number {
  const [value, setValue] = useState(firestoreEpoch);
  useEffect(() => onFirestoreReset(setValue), []);
  return value;
}

function subscribe(cid: string, uid: string, listener: (s: CircleState) => void): () => void {
  const key = `${cid}|${uid}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: INITIAL, listeners: new Set(), restarts: 0 };
    entries.set(key, entry);
  }
  if (entry.linger) {
    clearTimeout(entry.linger);
    entry.linger = undefined;
  }
  entry.listeners.add(listener);
  if (!entry.stop) start(entry, cid, uid);
  else if (entry.state.error && !entry.state.data) reloadCircle(cid, uid);
  listener(entry.state);

  const e = entry;
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size > 0) return;
    // Keep it warm so going back and forth doesn't churn identical listeners.
    e.linger = setTimeout(() => {
      if (e.listeners.size > 0) return;
      e.stop?.();
      entries.delete(key);
    }, LINGER_MS);
  };
}

/** Live circle data + the viewer's role (shared across every screen showing this circle). */
export function useCircleData(cid: string | undefined, uid: string | undefined): CircleState {
  const [state, setState] = useState<CircleState>(() =>
    cid && uid ? (entries.get(`${cid}|${uid}`)?.state ?? INITIAL) : INITIAL,
  );

  useEffect(() => {
    if (!cid || !uid) return;
    return subscribe(cid, uid, setState);
  }, [cid, uid]);

  return state;
}

export function useMyCircles(uid: string | undefined) {
  const [refs, setRefs] = useState<CircleRef[] | undefined>();
  const [error, setError] = useState<string>();
  const epoch = useFirestoreEpoch();

  useEffect(() => {
    if (!uid) {
      setRefs([]);
      return;
    }
    setError(undefined);
    return watchMyCircles(uid, setRefs, setError);
  }, [uid, epoch]);

  return { refs, error, loading: refs === undefined && !error };
}

/** Live payout requests: all of them for the admin, only the member's own otherwise. */
export function usePayouts(cid: string | undefined, role: Role, memberId: string | undefined) {
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const epoch = useFirestoreEpoch();
  useEffect(() => {
    if (!cid || role === 'none' || (role === 'member' && !memberId)) return;
    const viewer = role === 'admin' ? ({ role: 'admin' } as const) : ({ role: 'member', memberId: memberId! } as const);
    return watchPayouts(cid, viewer, setPayouts, () => setPayouts([]));
  }, [cid, role, memberId, epoch]);
  return payouts;
}

/** Live announcements for a circle, newest first. */
export function useAnnouncements(cid: string | undefined, enabled = true) {
  const [items, setItems] = useState<Announcement[]>([]);
  const epoch = useFirestoreEpoch();
  useEffect(() => {
    if (!cid || !enabled) return;
    return watchAnnouncements(cid, setItems, () => setItems([]));
  }, [cid, enabled, epoch]);
  return items;
}

/** Admin: live join requests for a circle. */
export function useJoinRequests(cid: string | undefined, enabled = true) {
  const [items, setItems] = useState<JoinRequest[]>([]);
  const epoch = useFirestoreEpoch();
  useEffect(() => {
    if (!cid || !enabled) return;
    return watchJoinRequests(cid, setItems);
  }, [cid, enabled, epoch]);
  return items;
}

/** Anyone: live list of circles open for joining. */
