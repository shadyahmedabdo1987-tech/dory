import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

import {
  buildMessages,
  chunk,
  claimedMessage,
  confirmedMessage,
  paymentEvent,
  type ExpoMessage,
  payoutEvent,
  payoutMessageFor,
  type PaymentDoc,
  type PayoutDoc,
} from './messages.js';

initializeApp();
const db: Firestore = getFirestore();

// Must match the Firestore database location (see docs/FIREBASE_SETUP.md).
const REGION = defineString('FUNCTIONS_REGION', { default: 'europe-west1' });
setGlobalOptions({ region: REGION, maxInstances: 20, memory: '256MiB' });

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tokensFor(uid: string | null | undefined): Promise<{ token: string; ref: DocumentReference }[]> {
  if (!uid) return [];
  const snap = await db.collection('users').doc(uid).collection('devices').get();
  return snap.docs
    .map((d) => ({ token: String(d.get('token') ?? ''), ref: d.ref }))
    .filter((d) => d.token);
}

/**
 * Sends through the Expo push service (handles both FCM and APNs) and removes
 * tokens Expo reports as no longer registered.
 */
async function send(
  devices: { token: string; ref: DocumentReference }[],
  content: { title: string; body: string },
  data: Record<string, string>,
): Promise<void> {
  const messages = buildMessages(devices.map((d) => d.token), content, data);
  if (messages.length === 0) return;
  const byToken = new Map(devices.map((d) => [d.token, d.ref]));

  for (const batch of chunk<ExpoMessage>(messages, 100)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        logger.warn('Expo push HTTP error', { status: res.status, body: await res.text() });
        continue;
      }
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      await Promise.all(
        (json.data ?? []).map((ticket, i) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            return byToken.get(batch[i].to)?.delete();
          }
          return undefined;
        }),
      );
    } catch (e) {
      // Notifications are best-effort: never fail the trigger (and retry-spam users).
      logger.error('Expo push failed', e);
    }
  }
}

function periodAmount(circle: DocumentData, periodId: string): number {
  const period = (circle.periods ?? []).find((p: { id: string }) => p.id === periodId);
  if (period?.kind === 'extra' && typeof period.amount === 'number') return period.amount;
  return Number(circle.installment) || 0;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Member says "I paid" → notify the admin. Admin confirms → notify the member. */
export const onPaymentWritten = onDocumentWritten('circles/{cid}/payments/{pid}', async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as PaymentDoc) : undefined;
  const after = event.data?.after.exists ? (event.data.after.data() as PaymentDoc) : undefined;
  const kind = paymentEvent(before, after);
  if (!kind || !after) return;

  const { cid } = event.params;
  const [circleSnap, memberSnap] = await Promise.all([
    db.collection('circles').doc(cid).get(),
    db.collection('circles').doc(cid).collection('members').doc(after.memberId).get(),
  ]);
  if (!circleSnap.exists || !memberSnap.exists) return;
  const circle = circleSnap.data()!;
  const member = memberSnap.data()!;
  const amount = periodAmount(circle, after.periodId);
  const data = { circleId: cid, type: kind };

  if (kind === 'claimed') {
    await send(await tokensFor(circle.adminUid), claimedMessage(circle.name, member.name, amount, after.method, after.hasReceipt), data);
  } else if (member.uid && member.uid !== circle.adminUid) {
    await send(await tokensFor(member.uid), confirmedMessage(circle.name, amount), data);
  }
});

/** Payout requests: recipient → admin on request; admin → recipient on decision or transfer. */
export const onPayoutWritten = onDocumentWritten('circles/{cid}/payouts/{pid}', async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as PayoutDoc) : undefined;
  const after = event.data?.after.exists ? (event.data.after.data() as PayoutDoc) : undefined;
  const kind = payoutEvent(before, after);
  if (!kind || !after) return;

  const { cid } = event.params;
  const [circleSnap, memberSnap] = await Promise.all([
    db.collection('circles').doc(cid).get(),
    db.collection('circles').doc(cid).collection('members').doc(after.recipientId).get(),
  ]);
  if (!circleSnap.exists || !memberSnap.exists) return;
  const circle = circleSnap.data()!;
  const member = memberSnap.data()!;
  const pot = (Number(circle.installment) || 0) * (Number(circle.memberCount) || 0);
  const content = payoutMessageFor(kind, circle.name, member.name, after, pot);
  const data = { circleId: cid, type: `payout-${kind}` };

  if (kind === 'requested') {
    await send(await tokensFor(circle.adminUid), content, data);
  } else if (member.uid && member.uid !== circle.adminUid) {
    await send(await tokensFor(member.uid), content, data);
  }
});
