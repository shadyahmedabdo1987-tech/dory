/**
 * Security-rules tests. Runs against the Firestore emulator:
 *   npm run test:rules
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const CID = 'circle1';
const CODE = 'ABC234';

let env;

const admin = () =>
  env.authenticatedContext('admin', { firebase: { sign_in_provider: 'password' } }).firestore();
const anon = (uid) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();

function circleData(overrides = {}) {
  return {
    name: 'جمعية الشغل',
    installment: 1000,
    currency: 'EGP',
    frequency: 'monthly',
    startDate: '2026-11-01',
    adminUid: 'admin',
    inviteCode: CODE,
    periods: [
      { id: 'p0', kind: 'payout', recipientId: 'm1' },
      { id: 'p1', kind: 'payout', recipientId: 'm2' },
    ],
    memberCount: 2,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
    ...overrides,
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'circles', CID), circleData());
    await setDoc(doc(db, 'circles', CID, 'members', 'm1'), { name: 'أحمد', uid: null, order: 0 });
    await setDoc(doc(db, 'circles', CID, 'members', 'm2'), { name: 'منى', uid: null, order: 1 });
    await setDoc(doc(db, 'circles', CID, 'contacts', 'm1'), { phone: '201011111111' });
    await setDoc(doc(db, 'circles', CID, 'phones', '201011111111'), { memberId: 'm1' });
    await setDoc(doc(db, 'invites', CODE), { circleId: CID, createdAt: serverTimestamp() });
  });
}

function joinBatch(db, uid, memberId = 'm1', inviteCode = CODE) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'circles', CID, 'members', memberId), { uid });
  batch.set(doc(db, 'circles', CID, 'memberships', uid), {
    uid,
    circleId: CID,
    memberId,
    inviteCode,
    joinedAt: serverTimestamp(),
  });
  return batch.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dory',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

describe('creating circles', () => {
  it('lets an account create a circle with members, contacts, phones and invite atomically', async () => {
    const db = admin();
    const batch = writeBatch(db);
    batch.set(doc(db, 'circles', 'new'), circleData({ inviteCode: 'XYZ789' }));
    batch.set(doc(db, 'circles', 'new', 'members', 'a'), { name: 'سارة', uid: null, order: 0, createdAt: serverTimestamp() });
    batch.set(doc(db, 'circles', 'new', 'contacts', 'a'), { phone: '201000000000' });
    batch.set(doc(db, 'circles', 'new', 'phones', '201000000000'), { memberId: 'a' });
    batch.set(doc(db, 'invites', 'XYZ789'), { circleId: 'new', createdAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('rejects anonymous users creating circles', async () => {
    await assertFails(setDoc(doc(anon('x'), 'circles', 'new'), circleData({ adminUid: 'x' })));
  });

  it('rejects invalid data', async () => {
    await assertFails(setDoc(doc(admin(), 'circles', 'bad'), circleData({ installment: -5 })));
    await assertFails(setDoc(doc(admin(), 'circles', 'bad'), circleData({ frequency: 'daily' })));
    await assertFails(setDoc(doc(admin(), 'circles', 'bad'), circleData({ hacked: true })));
  });

  it('rejects creating a circle for someone else', async () => {
    await assertFails(setDoc(doc(admin(), 'circles', 'new'), circleData({ adminUid: 'other' })));
  });
});

describe('joining', () => {
  it('lets a member join with the invite code and their phone lookup', async () => {
    const db = anon('u1');
    await assertSucceeds(getDoc(doc(db, 'invites', CODE)));
    await assertSucceeds(getDoc(doc(db, 'circles', CID, 'phones', '201011111111')));
    await assertSucceeds(joinBatch(db, 'u1'));
    await assertSucceeds(getDoc(doc(db, 'circles', CID)));
    await assertSucceeds(getDocs(collection(db, 'circles', CID, 'members')));
    await assertSucceeds(getDocs(collection(db, 'circles', CID, 'payments')));
  });

  it('rejects a wrong invite code', async () => {
    await assertFails(joinBatch(anon('u1'), 'u1', 'm1', 'WRONG2'));
  });

  it('rejects claiming a member row that is already linked', async () => {
    await assertSucceeds(joinBatch(anon('u1'), 'u1'));
    await assertFails(joinBatch(anon('u2'), 'u2'));
  });

  it('keeps phone numbers away from members', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(getDocs(collection(db, 'circles', CID, 'contacts')));
    await assertSucceeds(getDocs(collection(admin(), 'circles', CID, 'contacts')));
  });

  it('lists my circles through a collection-group query', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertSucceeds(getDocs(query(collectionGroup(db, 'memberships'), where('uid', '==', 'u1'))));
    await assertFails(getDocs(query(collectionGroup(db, 'memberships'), where('uid', '==', 'someone'))));
  });

  it('lets a member leave', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'circles', CID, 'members', 'm1'), { uid: null });
    batch.delete(doc(db, 'circles', CID, 'memberships', 'u1'));
    await assertSucceeds(batch.commit());
  });
});

describe('join requests (approved in the app)', () => {
  const request = (db, uid, overrides = {}) =>
    setDoc(doc(db, 'circles', CID, 'joinRequests', uid), {
      uid,
      name: 'منى',
      inviteCode: CODE,
      createdAt: serverTimestamp(),
      ...overrides,
    });

  it('lets anyone with the code ask to join, and only for themselves', async () => {
    await assertSucceeds(request(anon('u1'), 'u1'));
    await assertFails(request(anon('u1'), 'u2'));
    await assertFails(request(anon('u3'), 'u3', { inviteCode: 'ZZZ999' }));
    await assertFails(request(anon('u3'), 'u3', { name: '' }));
    await assertFails(request(anon('u3'), 'u3', { phone: '201011111111' }));
  });

  it('shows requests to the admin and to the requester only', async () => {
    await request(anon('u1'), 'u1');
    await assertSucceeds(getDocs(collection(admin(), 'circles', CID, 'joinRequests')));
    await assertSucceeds(getDoc(doc(anon('u1'), 'circles', CID, 'joinRequests', 'u1')));
    await assertFails(getDoc(doc(anon('u2'), 'circles', CID, 'joinRequests', 'u1')));
    await assertFails(getDocs(collection(anon('u2'), 'circles', CID, 'joinRequests')));
  });

  it('lets the admin approve: link the row + device and remove the request in one batch', async () => {
    await request(anon('u1'), 'u1');
    const db = admin();
    const batch = writeBatch(db);
    batch.update(doc(db, 'circles', CID, 'members', 'm2'), { uid: 'u1' });
    batch.set(doc(db, 'circles', CID, 'memberships', 'u1'), {
      uid: 'u1',
      circleId: CID,
      memberId: 'm2',
      inviteCode: CODE,
      joinedAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'circles', CID, 'joinRequests', 'u1'));
    await assertSucceeds(batch.commit());
    // The new member now sees the circle.
    await assertSucceeds(getDoc(doc(anon('u1'), 'circles', CID)));
  });

  it('blocks a requester from approving themselves', async () => {
    await request(anon('u1'), 'u1');
    const db = anon('u1');
    const batch = writeBatch(db);
    batch.set(doc(db, 'circles', CID, 'memberships', 'u1'), {
      uid: 'u1',
      circleId: CID,
      memberId: 'm2',
      inviteCode: CODE,
      joinedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('lets the admin reject and the requester cancel', async () => {
    await request(anon('u1'), 'u1');
    await assertSucceeds(deleteDoc(doc(admin(), 'circles', CID, 'joinRequests', 'u1')));
    await request(anon('u2'), 'u2');
    await assertSucceeds(deleteDoc(doc(anon('u2'), 'circles', CID, 'joinRequests', 'u2')));
    await request(anon('u3'), 'u3');
    await assertFails(deleteDoc(doc(anon('u4'), 'circles', CID, 'joinRequests', 'u3')));
  });
});

describe('privacy', () => {
  it('hides circles from strangers', async () => {
    const db = anon('stranger');
    await assertFails(getDoc(doc(db, 'circles', CID)));
    await assertFails(getDocs(collection(db, 'circles', CID, 'members')));
    await assertFails(getDocs(collection(db, 'circles', CID, 'payments')));
    await assertFails(getDocs(query(collection(db, 'circles'), where('adminUid', '==', 'admin'))));
  });

  it('lets the admin list their circles', async () => {
    await assertSucceeds(getDocs(query(collection(admin(), 'circles'), where('adminUid', '==', 'admin'))));
  });
});

describe('payments', () => {
  const claim = (memberId, by, status = 'claimed') => ({
    periodId: 'p0',
    memberId,
    status,
    claimedAt: new Date().toISOString(),
    claimedBy: by,
  });

  it('lets a member claim and withdraw their own payment', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    const ref = doc(db, 'circles', CID, 'payments', 'p0_m1');
    await assertSucceeds(setDoc(ref, claim('m1', 'u1')));
    await assertSucceeds(deleteDoc(ref));
  });

  it("blocks claiming someone else's payment or confirming", async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(setDoc(doc(db, 'circles', CID, 'payments', 'p0_m2'), claim('m2', 'u1')));
    await assertFails(setDoc(doc(db, 'circles', CID, 'payments', 'p0_m1'), claim('m1', 'u1', 'confirmed')));
    await assertFails(setDoc(doc(db, 'circles', CID, 'payments', 'wrong_id'), claim('m1', 'u1')));
  });

  it('lets only the admin confirm, and then the member cannot undo it', async () => {
    const member = anon('u1');
    await joinBatch(member, 'u1');
    await setDoc(doc(member, 'circles', CID, 'payments', 'p0_m1'), claim('m1', 'u1'));

    await assertSucceeds(
      setDoc(
        doc(admin(), 'circles', CID, 'payments', 'p0_m1'),
        { periodId: 'p0', memberId: 'm1', status: 'confirmed', confirmedAt: new Date().toISOString(), confirmedBy: 'admin' },
        { merge: true },
      ),
    );
    await assertFails(deleteDoc(doc(member, 'circles', CID, 'payments', 'p0_m1')));
  });

  it('blocks members from editing the circle or roster', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(updateDoc(doc(db, 'circles', CID), { installment: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'circles', CID, 'members', 'm2'), { name: 'x' }));
  });
});

describe('admin edits', () => {
  it('updates the timeline with a fresh timestamp only', async () => {
    const ref = doc(admin(), 'circles', CID);
    await assertSucceeds(updateDoc(ref, { periods: [{ id: 'p0', kind: 'skip' }], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { periods: [] }));
    await assertFails(updateDoc(ref, { adminUid: 'thief', updatedAt: serverTimestamp() }));
  });

  it('can unlink a member device', async () => {
    await joinBatch(anon('u1'), 'u1');
    const db = admin();
    const batch = writeBatch(db);
    batch.delete(doc(db, 'circles', CID, 'memberships', 'u1'));
    batch.update(doc(db, 'circles', CID, 'members', 'm1'), { uid: null });
    await assertSucceeds(batch.commit());
  });
});

describe('push tokens', () => {
  const device = (platform = 'android') => ({ token: 'ExponentPushToken[abc]', platform, updatedAt: serverTimestamp() });

  it('lets users manage only their own devices', async () => {
    const db = anon('u1');
    await assertSucceeds(setDoc(doc(db, 'users', 'u1', 'devices', 'd1'), device()));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'u1', 'devices', 'd1')));
    await assertFails(setDoc(doc(db, 'users', 'u2', 'devices', 'd1'), device()));
    await assertFails(getDoc(doc(anon('u2'), 'users', 'u1', 'devices', 'd1')));
  });

  it('validates the token document', async () => {
    await assertFails(setDoc(doc(anon('u1'), 'users', 'u1', 'devices', 'd1'), device('windows')));
    await assertFails(setDoc(doc(anon('u1'), 'users', 'u1', 'devices', 'd1'), { ...device(), extra: 1 }));
  });
});

describe('payment methods & receipts', () => {
  const claimDoc = (memberId, by, method, extra = {}) => ({
    periodId: 'p0',
    memberId,
    status: 'claimed',
    claimedAt: new Date().toISOString(),
    claimedBy: by,
    method,
    ...extra,
  });
  const receipt = (memberId, by) => ({
    image: 'data',
    memberId,
    periodId: 'p0',
    uploadedBy: by,
    createdAt: serverTimestamp(),
  });

  it('accepts a cash claim without a receipt', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertSucceeds(setDoc(doc(db, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'cash')));
  });

  it('rejects a transfer claim without a screenshot', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(
      setDoc(doc(db, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'instapay', { hasReceipt: true })),
    );
  });

  it('accepts a transfer claim with its screenshot in the same batch', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    const batch = writeBatch(db);
    batch.set(doc(db, 'circles', CID, 'receipts', 'p0_m1'), receipt('m1', 'u1'));
    batch.set(doc(db, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'vodafone_cash', { hasReceipt: true }));
    await assertSucceeds(batch.commit());

    // Owner and admin can see it; another member can't.
    await assertSucceeds(getDoc(doc(db, 'circles', CID, 'receipts', 'p0_m1')));
    await assertSucceeds(getDoc(doc(admin(), 'circles', CID, 'receipts', 'p0_m1')));
  });

  it("blocks reading or forging someone else's screenshot", async () => {
    const owner = anon('u1');
    await joinBatch(owner, 'u1');
    const batch = writeBatch(owner);
    batch.set(doc(owner, 'circles', CID, 'receipts', 'p0_m1'), receipt('m1', 'u1'));
    batch.set(doc(owner, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'instapay', { hasReceipt: true }));
    await batch.commit();

    const other = anon('u2');
    await joinBatch(other, 'u2', 'm2');
    await assertFails(getDoc(doc(other, 'circles', CID, 'receipts', 'p0_m1')));
    await assertFails(setDoc(doc(other, 'circles', CID, 'receipts', 'p0_m1'), receipt('m1', 'u2')));
  });

  it('lets the member withdraw a claim together with its screenshot', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    const create = writeBatch(db);
    create.set(doc(db, 'circles', CID, 'receipts', 'p0_m1'), receipt('m1', 'u1'));
    create.set(doc(db, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'instapay', { hasReceipt: true }));
    await create.commit();

    const undo = writeBatch(db);
    undo.delete(doc(db, 'circles', CID, 'payments', 'p0_m1'));
    undo.delete(doc(db, 'circles', CID, 'receipts', 'p0_m1'));
    await assertSucceeds(undo.commit());
  });

  it('rejects unknown methods and oversized images', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(setDoc(doc(db, 'circles', CID, 'payments', 'p0_m1'), claimDoc('m1', 'u1', 'bitcoin')));
    await assertFails(
      setDoc(doc(db, 'circles', CID, 'receipts', 'p0_m1'), { ...receipt('m1', 'u1'), image: 'x'.repeat(900001) }),
    );
  });

  it('stores the admin transfer details on the circle', async () => {
    const ref = doc(admin(), 'circles', CID);
    await assertSucceeds(
      updateDoc(ref, { payInfo: { instapay: 'shady@instapay', vodafoneCash: '01012345678' }, updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(ref, { payInfo: { bank: 'x' }, updatedAt: serverTimestamp() }));
  });
});

describe('payout requests', () => {
  const request = (by, extra = {}) => ({
    periodId: 'p0',
    recipientId: 'm1',
    status: 'requested',
    method: 'vodafone_cash',
    account: '01011111111',
    requestedAt: new Date().toISOString(),
    requestedBy: by,
    ...extra,
  });

  it('lets the recipient request and change their payout method', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    const ref = doc(db, 'circles', CID, 'payouts', 'p0');
    await assertSucceeds(setDoc(ref, request('u1')));
    await assertSucceeds(setDoc(ref, { method: 'instapay', account: 'ahmed@instapay', requestedAt: 'x', requestedBy: 'u1', status: 'requested' }, { merge: true }));
    await assertSucceeds(getDoc(ref));
  });

  it("blocks requesting someone else's payout or self-approving", async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), request('u1', { recipientId: 'm2' })));
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), request('u1', { status: 'approved' })));
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), request('u1', { status: 'paid', hasReceipt: true })));
  });

  it('hides payout accounts from other members', async () => {
    const owner = anon('u1');
    await joinBatch(owner, 'u1');
    await setDoc(doc(owner, 'circles', CID, 'payouts', 'p0'), request('u1'));
    const other = anon('u2');
    await joinBatch(other, 'u2', 'm2');
    await assertFails(getDoc(doc(other, 'circles', CID, 'payouts', 'p0')));
    await assertSucceeds(getDocs(query(collection(other, 'circles', CID, 'payouts'), where('recipientId', '==', 'm2'))));
    await assertFails(getDocs(collection(other, 'circles', CID, 'payouts')));
  });

  it('freezes the request once the admin approves it', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), request('u1'));
    await assertSucceeds(
      setDoc(doc(admin(), 'circles', CID, 'payouts', 'p0'), { status: 'approved', decidedAt: 'now', decidedBy: 'admin' }, { merge: true }),
    );
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), { method: 'cash', status: 'requested', requestedBy: 'u1', requestedAt: 'x' }, { merge: true }));
  });

  it('lets the admin pay out with a transfer screenshot the recipient can see', async () => {
    const member = anon('u1');
    await joinBatch(member, 'u1');
    const db = admin();
    const batch = writeBatch(db);
    batch.set(doc(db, 'circles', CID, 'payoutReceipts', 'p0'), {
      image: 'data',
      recipientId: 'm1',
      periodId: 'p0',
      uploadedBy: 'admin',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'circles', CID, 'payouts', 'p0'), {
      periodId: 'p0',
      recipientId: 'm1',
      status: 'paid',
      method: 'instapay',
      account: 'ahmed@instapay',
      paidAt: 'now',
      hasReceipt: true,
    });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(member, 'circles', CID, 'payoutReceipts', 'p0')));

    const other = anon('u2');
    await joinBatch(other, 'u2', 'm2');
    await assertFails(getDoc(doc(other, 'circles', CID, 'payoutReceipts', 'p0')));
    await assertFails(setDoc(doc(member, 'circles', CID, 'payoutReceipts', 'p1'), { image: 'x', recipientId: 'm1', periodId: 'p1', uploadedBy: 'u1', createdAt: serverTimestamp() }));
  });
});

describe('payout receipt confirmation', () => {
  async function paidPayout() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'circles', CID, 'payouts', 'p0'), {
        periodId: 'p0', recipientId: 'm1', status: 'paid', method: 'instapay', account: 'a@instapay', hasReceipt: true, paidAt: 'now',
      });
    });
  }

  it('lets the recipient confirm the money arrived', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await paidPayout();
    await assertSucceeds(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), { status: 'received', receivedAt: 'now' }, { merge: true }));
  });

  it('lets the recipient report it did not arrive, then confirm later', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await paidPayout();
    const ref = doc(db, 'circles', CID, 'payouts', 'p0');
    await assertSucceeds(setDoc(ref, { status: 'disputed', disputeNote: 'لسه ما وصلش' }, { merge: true }));
    await assertSucceeds(setDoc(ref, { status: 'received', receivedAt: 'now' }, { merge: true }));
  });

  it('blocks confirming before payment, by someone else, or changing the amount details', async () => {
    const db = anon('u1');
    await joinBatch(db, 'u1');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'circles', CID, 'payouts', 'p0'), {
        periodId: 'p0', recipientId: 'm1', status: 'approved', method: 'cash',
      });
    });
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), { status: 'received', receivedAt: 'now' }, { merge: true }));

    await paidPayout();
    await assertFails(setDoc(doc(db, 'circles', CID, 'payouts', 'p0'), { status: 'received', method: 'cash' }, { merge: true }));
    const other = anon('u2');
    await joinBatch(other, 'u2', 'm2');
    await assertFails(setDoc(doc(other, 'circles', CID, 'payouts', 'p0'), { status: 'received', receivedAt: 'now' }, { merge: true }));
  });
});

describe('whatsapp group & announcements', () => {
  it('stores a valid WhatsApp group link and rejects anything else', async () => {
    const ref = doc(admin(), 'circles', CID);
    await assertSucceeds(updateDoc(ref, { whatsappGroup: 'https://chat.whatsapp.com/AbCdEf1234567890', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { whatsappGroup: 'https://evil.example/phish', updatedAt: serverTimestamp() }));
  });

  it('lets only the admin post announcements, and members read them', async () => {
    const member = anon('u1');
    await joinBatch(member, 'u1');
    const msg = { title: 'تذكير', body: 'القسط بكرة', createdAt: serverTimestamp() };
    await assertSucceeds(addDocTo(admin(), { ...msg, createdBy: 'admin' }));
    await assertFails(addDocTo(member, { ...msg, createdBy: 'u1' }));
    await assertSucceeds(getDocs(collection(member, 'circles', CID, 'announcements')));
    await assertFails(getDocs(collection(anon('stranger'), 'circles', CID, 'announcements')));
  });
});

function addDocTo(db, data) {
  return setDoc(doc(collection(db, 'circles', CID, 'announcements')), data);
}
