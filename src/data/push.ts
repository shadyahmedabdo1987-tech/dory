import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

import { firestore } from './firebase';

/**
 * Push notifications without a server: the device that does something
 * (admin posts an announcement, a member says "I paid", …) sends the
 * notification straight to the other people's phones through Expo's push
 * service, which shows it on their screen even when the app is closed.
 *
 * Every device stores its push token per circle at circles/{cid}/pushTokens/{uid}
 * (admin reads all; members read the admin's). Everything here is best-effort:
 * a failed push never fails the action itself.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

let myToken: string | null = null;

/** Set by the notifications module once this device has a push token. */
export function setMyPushToken(token: string | null) {
  myToken = token;
}

export function myPushToken(): string | null {
  return myToken;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it should go: the circle screen. */
  circleId?: string;
  /** Android channel (created on every device): 'payments' | 'reminders' | 'announcements'. */
  channelId?: 'payments' | 'reminders' | 'announcements';
}

const tokensCol = (cid: string) => collection(firestore(), 'circles', cid, 'pushTokens');

/** Saves this device's token for a circle so the others can reach it. */
export async function saveCirclePushToken(cid: string, uid: string) {
  if (!myToken) return;
  try {
    await setDoc(doc(tokensCol(cid), uid), { token: myToken, updatedAt: serverTimestamp() });
  } catch {
    // Not a member (yet) or offline — try again next time.
  }
}

/**
 * Sign-out: this phone stops being reachable as me in every circle. Otherwise the next person
 * who signs in on it would still get my notifications (e.g. "مبروك! قبضت جمعيتك" for my turn).
 */
export async function clearMyCirclePushTokens(uid: string, cids: string[]) {
  await Promise.all(
    cids.map((cid) => setDoc(doc(tokensCol(cid), uid), { token: '', updatedAt: serverTimestamp() }).catch(() => {})),
  );
}

export async function sendPush(tokens: (string | null | undefined)[], msg: PushMessage): Promise<void> {
  const to = [...new Set(tokens.filter((t): t is string => !!t && t !== myToken))];
  if (to.length === 0) return;
  const messages = to.map((t) => ({
    to: t,
    title: msg.title,
    body: msg.body,
    sound: 'default',
    priority: 'high',
    channelId: msg.channelId ?? 'payments',
    data: msg.circleId ? { circleId: msg.circleId } : {},
  }));
  try {
    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }
  } catch {
    // best effort
  }
}

async function tokenOf(cid: string, uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(tokensCol(cid), uid));
    return snap.exists() ? String(snap.data().token ?? '') || null : null;
  } catch {
    return null;
  }
}

/** Specific people in a circle (by their user ids). */
export async function pushToUids(cid: string, uids: (string | null | undefined)[], msg: PushMessage) {
  const wanted = uids.filter((u): u is string => !!u);
  if (wanted.length === 0) return;
  // The organizer can see every phone in the circle: a phone that moved on to another member
  // (signed out, someone else signed in) only gets messages meant for whoever is on it now.
  try {
    const snap = await getDocs(tokensCol(cid));
    const owner = new Map<string, { uid: string; at: number }>();
    for (const d of snap.docs) {
      const t = String(d.data().token ?? '');
      if (!t) continue;
      const at = (d.data().updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const cur = owner.get(t);
      if (!cur || at > cur.at) owner.set(t, { uid: d.id, at });
    }
    const set = new Set(wanted);
    const tokens = [...owner.entries()].filter(([, o]) => set.has(o.uid)).map(([t]) => t);
    await sendPush(tokens, { circleId: cid, ...msg });
    return;
  } catch {
    // Not the organizer (can't list): each person's own token.
  }
  const tokens = await Promise.all(wanted.map((u) => tokenOf(cid, u)));
  await sendPush(tokens, { circleId: cid, ...msg });
}

/** Admin → everyone else in the circle. */
export async function pushToMembers(cid: string, exceptUid: string, msg: PushMessage) {
  try {
    const snap = await getDocs(tokensCol(cid));
    const mine = snap.docs.find((d) => d.id === exceptUid)?.data().token;
    const tokens = snap.docs.filter((d) => d.id !== exceptUid).map((d) => String(d.data().token ?? '')).filter((t) => t && t !== mine);
    await sendPush(tokens, { circleId: cid, ...msg });
  } catch {
    // best effort
  }
}

/** Member → the circle's admin. */
export async function pushToAdmin(cid: string, msg: PushMessage) {
  try {
    const circle = await getDoc(doc(firestore(), 'circles', cid));
    const adminUid = circle.exists() ? String(circle.data().adminUid ?? '') : '';
    if (adminUid) await pushToUids(cid, [adminUid], msg);
  } catch {
    // best effort
  }
}

/** The circle's name for message text (admin and members can read it). */
export async function circleNameOf(cid: string): Promise<string> {
  try {
    const snap = await getDoc(doc(firestore(), 'circles', cid));
    return snap.exists() ? String(snap.data().name ?? '') : '';
  } catch {
    return '';
  }
}

/** A member row's linked user id (for "your payment was confirmed"). */
export async function uidOfMember(cid: string, memberId: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(firestore(), 'circles', cid, 'members', memberId));
    return snap.exists() ? ((snap.data().uid as string | null) ?? null) : null;
  } catch {
    return null;
  }
}

/** A member's display name (for "X says they paid"). */
export async function memberNameOf(cid: string, memberId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(firestore(), 'circles', cid, 'members', memberId));
    return snap.exists() ? String(snap.data().name ?? '') : '';
  } catch {
    return '';
  }
}
