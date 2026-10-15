import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import type { PayoutRequest } from '@/core';

import { watchCircle, watchMembership, watchMyCircles, watchPayouts, type CircleRef, type CircleSnapshot } from './circles';
import { arabicError, retry } from './errors';
import { firestore } from './firebase';

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

/** Live circle data + the viewer's role, for one circle screen. */
export function useCircleData(cid: string | undefined, uid: string | undefined): CircleState {
  const [state, setState] = useState<CircleState>({ loading: true, role: 'none', notFound: false });

  useEffect(() => {
    if (!cid || !uid) return;
    let cancelled = false;
    let unsubCircle: (() => void) | undefined;
    let myMemberId: string | undefined;

    const unsubMembership = watchMembership(cid, uid, (memberId) => {
      myMemberId = memberId ?? undefined;
      // A member whose device link was removed loses access to the circle.
      setState((s) => ({ ...s, myMemberId, notFound: s.role === 'member' && !memberId ? true : s.notFound }));
    });

    (async () => {
      try {
        // Find out whether we're the admin before subscribing, so only the
        // admin's device asks for members' phone numbers.
        const snap = await retry(() => getDoc(doc(firestore(), 'circles', cid)));
        if (cancelled) return;
        if (!snap.exists()) {
          setState({ loading: false, role: 'none', notFound: true });
          return;
        }
        const isAdmin = snap.data().adminUid === uid;
        unsubCircle = watchCircle(
          cid,
          { withContacts: isAdmin },
          (data) =>
            setState({
              loading: false,
              data: data ?? undefined,
              notFound: !data,
              role: isAdmin ? 'admin' : 'member',
              myMemberId,
            }),
          (error) => setState((s) => ({ ...s, loading: false, error })),
        );
      } catch (e) {
        if (cancelled) return;
        const code = (e as { code?: string }).code;
        setState({ loading: false, role: 'none', notFound: code === 'permission-denied', error: arabicError(e) });
      }
    })();

    return () => {
      cancelled = true;
      unsubMembership();
      unsubCircle?.();
    };
  }, [cid, uid]);

  return state;
}

export function useMyCircles(uid: string | undefined) {
  const [refs, setRefs] = useState<CircleRef[] | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!uid) {
      setRefs([]);
      return;
    }
    setRefs(undefined);
    return watchMyCircles(uid, setRefs, setError);
  }, [uid]);

  return { refs, error, loading: refs === undefined && !error };
}

/** Live payout requests: all of them for the admin, only the member's own otherwise. */
export function usePayouts(cid: string | undefined, role: Role, memberId: string | undefined) {
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  useEffect(() => {
    if (!cid || role === 'none' || (role === 'member' && !memberId)) return;
    const viewer = role === 'admin' ? ({ role: 'admin' } as const) : ({ role: 'member', memberId: memberId! } as const);
    return watchPayouts(cid, viewer, setPayouts, () => setPayouts([]));
  }, [cid, role, memberId]);
  return payouts;
}
