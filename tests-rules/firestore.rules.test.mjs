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
