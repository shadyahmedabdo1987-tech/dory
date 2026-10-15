import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';

import {
  generateInviteCode,
  initialPeriods,
  normalizePhone,
  paymentId,
  syncPeriodsWithMembers,
  type Circle,
  type CircleDraft,
  type Frequency,
  requiresReceipt,
  validateClaim,
  type Member,
  type PayInfo,
  type Payment,
  type PaymentMethod,
  type Period,
} from '@/core';

import { AppError, arabicError, retry, withTimeout } from './errors';
import { firestore } from './firebase';

/**
 * Data access for circles. Every multi-document change is a single atomic
 * batch or transaction, so a dropped connection never leaves half-written data.
 */

const SCHEMA_VERSION = 1;
const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch; keep headroom.

const circleRef = (db: Firestore, cid: string) => doc(db, 'circles', cid);
const membersCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'members');
const paymentsCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'payments');
const contactsCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'contacts');
const phoneRef = (db: Firestore, cid: string, phone: string) => doc(db, 'circles', cid, 'phones', phone);
const membershipRef = (db: Firestore, cid: string, uid: string) => doc(db, 'circles', cid, 'memberships', uid);
const inviteRef = (db: Firestore, code: string) => doc(db, 'invites', code);

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

type CircleDoc = Omit<Circle, 'id' | 'members' | 'createdAt'> & {
  memberCount: number;
  createdAt?: { toDate(): Date } | null;
};

/** Firestore rejects `undefined`; strip optional fields from periods before writing. */
function cleanPeriods(periods: Period[]): Period[] {
  return periods.map((p) => {
    const out: Period = { id: p.id, kind: p.kind };
    if (p.recipientId) out.recipientId = p.recipientId;
    if (p.amount != null) out.amount = p.amount;
    if (p.paidOut) out.paidOut = true;
    if (p.note) out.note = p.note.slice(0, 120);
    return out;
  });
}

function circleFromDoc(id: string, data: DocumentData, members: Member[]): Circle {
  const d = data as CircleDoc;
  return {
    id,
    name: d.name,
    installment: d.installment,
    currency: d.currency ?? 'EGP',
    frequency: d.frequency,
    startDate: d.startDate,
    adminUid: d.adminUid,
    inviteCode: d.inviteCode,
    payInfo: d.payInfo ?? undefined,
    periods: Array.isArray(d.periods) ? d.periods : [],
    members,
    createdAt: d.createdAt?.toDate?.().toISOString() ?? new Date().toISOString(),
  };
}

function memberFromDoc(id: string, data: DocumentData): Member & { order: number } {
  return { id, name: data.name, uid: data.uid ?? null, order: data.order ?? 0 };
}

function paymentFromDoc(id: string, data: DocumentData): Payment {
  return {
    id,
    periodId: data.periodId,
    memberId: data.memberId,
    status: data.status,
    method: data.method ?? undefined,
    hasReceipt: data.hasReceipt === true,
    claimedAt: data.claimedAt ?? undefined,
    confirmedAt: data.confirmedAt ?? undefined,
    note: data.note ?? undefined,
  };
}

function memberDoc(m: Member, order: number) {
  return { name: m.name.trim().slice(0, 60), uid: m.uid ?? null, order };
}

const phoneOf = (m: Member | undefined) => (m?.phone ? normalizePhone(m.phone) : null);

// ---------------------------------------------------------------------------
// Live subscriptions
// ---------------------------------------------------------------------------

export interface CircleSnapshot {
  circle: Circle;
  payments: Payment[];
}

/**
 * Streams a circle with its members and payments. Calls `onData` only once all
 * three listeners have delivered, so screens never render a partial circle.
 */
export function watchCircle(
  cid: string,
  options: { withContacts: boolean },
  onData: (snap: CircleSnapshot | null) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const db = firestore();
  let circleData: DocumentData | null | undefined;
  let members: (Member & { order: number })[] | undefined;
  let payments: Payment[] | undefined;
  // Phone numbers are admin-only; members never download them.
  let contacts: Map<string, string> | undefined = options.withContacts ? undefined : new Map();

  const emit = () => {
    if (circleData === undefined || members === undefined || payments === undefined || contacts === undefined) return;
    if (circleData === null) return onData(null);
    const sorted = [...members]
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...m }) => ({ ...m, phone: contacts!.get(m.id) }));
    onData({ circle: circleFromDoc(cid, circleData, sorted), payments });
  };
  const fail = (e: unknown) => onError(arabicError(e));

  const unsubs = [
    onSnapshot(
      circleRef(db, cid),
      (s) => {
        circleData = s.exists() ? s.data() : null;
        emit();
      },
      fail,
    ),
    onSnapshot(
      membersCol(db, cid),
      (s) => {
        members = s.docs.map((d) => memberFromDoc(d.id, d.data()));
        emit();
      },
      fail,
    ),
    onSnapshot(
      paymentsCol(db, cid),
      (s) => {
        payments = s.docs.map((d) => paymentFromDoc(d.id, d.data()));
        emit();
      },
      fail,
    ),
  ];
  if (options.withContacts) {
    unsubs.push(
      onSnapshot(
        contactsCol(db, cid),
        (s) => {
          contacts = new Map(s.docs.filter((d) => d.data().phone).map((d) => [d.id, String(d.data().phone)]));
          emit();
        },
        fail,
      ),
    );
  }
  return () => unsubs.forEach((u) => u());
}

export interface CircleRef {
  id: string;
  role: 'admin' | 'member';
  memberId?: string;
}

/** Streams the ids of every circle the user administers or belongs to. */
export function watchMyCircles(
  uid: string,
  onData: (refs: CircleRef[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const db = firestore();
  let admin: CircleRef[] | undefined;
  let member: CircleRef[] | undefined;
  const emit = () => {
    if (!admin || !member) return;
    const adminIds = new Set(admin.map((r) => r.id));
    onData([...admin, ...member.filter((r) => !adminIds.has(r.id))]);
  };
  const fail = (e: unknown) => onError(arabicError(e));

  const unsubs = [
    onSnapshot(
      query(collection(db, 'circles'), where('adminUid', '==', uid)),
      (s) => {
        admin = s.docs.map((d) => ({ id: d.id, role: 'admin' as const }));
        emit();
      },
      fail,
    ),
    onSnapshot(
      query(collectionGroup(db, 'memberships'), where('uid', '==', uid)),
      (s) => {
        member = s.docs.map((d) => ({
          id: String(d.data().circleId),
          role: 'member' as const,
          memberId: String(d.data().memberId),
        }));
        emit();
      },
      fail,
    ),
  ];
  return () => unsubs.forEach((u) => u());
}

export function watchMembership(
  cid: string,
  uid: string,
  onData: (memberId: string | null) => void,
): Unsubscribe {
  return onSnapshot(
    membershipRef(firestore(), cid, uid),
    (s) => onData(s.exists() ? String(s.data().memberId) : null),
    () => onData(null),
  );
}

// ---------------------------------------------------------------------------
// Admin: create / edit / delete
// ---------------------------------------------------------------------------

async function uniqueInviteCode(db: Firestore): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateInviteCode();
    const snap = await retry(() => getDoc(inviteRef(db, code)));
    if (!snap.exists()) return code;
  }
  throw new AppError('unavailable', 'تعذر إنشاء كود. جرّب تاني.');
}

export async function createCircle(draft: CircleDraft, adminUid: string): Promise<string> {
  const db = firestore();
  const ref = doc(collection(db, 'circles'));
  const code = await uniqueInviteCode(db);

  // Give members Firestore ids up front so periods can reference them.
  const members = draft.members.map((m) => ({ ...m, id: doc(membersCol(db, ref.id)).id }));
  const periods = initialPeriods(members);

  const batch = writeBatch(db);
  batch.set(ref, {
    name: draft.name.trim().slice(0, 60),
    installment: draft.installment,
    currency: 'EGP',
    frequency: draft.frequency,
    startDate: draft.startDate,
    adminUid,
    inviteCode: code,
    periods: cleanPeriods(periods),
    memberCount: members.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
  });
  members.forEach((m, i) => {
    const phone = phoneOf(m);
    batch.set(doc(membersCol(db, ref.id), m.id), { ...memberDoc(m, i), createdAt: serverTimestamp() });
    batch.set(doc(contactsCol(db, ref.id), m.id), { phone });
    if (phone) batch.set(phoneRef(db, ref.id, phone), { memberId: m.id });
  });
  batch.set(inviteRef(db, code), { circleId: ref.id, createdAt: serverTimestamp() });

  await withTimeout(batch.commit());
  return ref.id;
}

export async function updateSettings(
  cid: string,
  settings: { name: string; installment: number; frequency: Frequency; startDate: string },
): Promise<void> {
  await withTimeout(
    updateDoc(circleRef(firestore(), cid), {
      name: settings.name.trim().slice(0, 60),
      installment: settings.installment,
      frequency: settings.frequency,
      startDate: settings.startDate,
      updatedAt: serverTimestamp(),
    }),
  );
}

/**
 * Applies a pure change to the timeline inside a transaction, so two admin
 * devices editing at once can't overwrite each other's changes.
 */
export async function mutatePeriods(cid: string, change: (periods: Period[]) => Period[]): Promise<void> {
  const db = firestore();
  await withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(circleRef(db, cid));
      if (!snap.exists()) throw new AppError('not-found', arabicError({ code: 'not-found' }));
      const next = change((snap.data().periods ?? []) as Period[]);
      tx.update(circleRef(db, cid), { periods: cleanPeriods(next), updatedAt: serverTimestamp() });
    }),
  );
}

/**
 * Saves settings + roster in one atomic batch: adds, edits and removes members
 * and keeps phone lookups and the timeline in sync.
 */
export async function saveCircle(
  circle: Circle,
  next: Member[],
  settings?: { name: string; installment: number; frequency: Frequency; startDate: string },
): Promise<void> {
  const db = firestore();
  const cid = circle.id;
  const before = new Map(circle.members.map((m) => [m.id, m]));
  const withIds = next.map((m) => (before.has(m.id) ? m : { ...m, id: doc(membersCol(db, cid)).id }));
  const keep = new Set(withIds.map((m) => m.id));

  const batch = writeBatch(db);

  // Phone lookups to remove first (a phone can move from one member to another).
  const removedPhones = new Set<string>();
  const addedPhones = new Map<string, string>();
  for (const old of circle.members) {
    const oldPhone = phoneOf(old);
    const now = withIds.find((m) => m.id === old.id);
    if (oldPhone && (!now || phoneOf(now) !== oldPhone)) removedPhones.add(oldPhone);
  }
  for (const m of withIds) {
    const phone = phoneOf(m);
    if (phone && phone !== phoneOf(before.get(m.id))) addedPhones.set(phone, m.id);
  }
  removedPhones.forEach((p) => !addedPhones.has(p) && batch.delete(phoneRef(db, cid, p)));
  addedPhones.forEach((memberId, p) => batch.set(phoneRef(db, cid, p), { memberId }));

  for (const [i, m] of withIds.entries()) {
    const old = before.get(m.id);
    const data = memberDoc({ ...m, uid: old?.uid ?? null }, i);
    if (old) batch.update(doc(membersCol(db, cid), m.id), data);
    else batch.set(doc(membersCol(db, cid), m.id), { ...data, createdAt: serverTimestamp() });
    batch.set(doc(contactsCol(db, cid), m.id), { phone: phoneOf(m) });
  }

  for (const old of circle.members) {
    if (keep.has(old.id)) continue;
    batch.delete(doc(membersCol(db, cid), old.id));
    batch.delete(doc(contactsCol(db, cid), old.id));
    if (old.uid) batch.delete(membershipRef(db, cid, old.uid));
  }

  batch.update(circleRef(db, cid), {
    ...(settings && {
      name: settings.name.trim().slice(0, 60),
      installment: settings.installment,
      frequency: settings.frequency,
      startDate: settings.startDate,
    }),
    periods: cleanPeriods(syncPeriodsWithMembers(circle.periods, withIds)),
    memberCount: withIds.length,
    updatedAt: serverTimestamp(),
  });

  await withTimeout(batch.commit());
}

export async function rotateInviteCode(circle: Circle): Promise<string> {
  const db = firestore();
  const code = await uniqueInviteCode(db);
  const batch = writeBatch(db);
  batch.delete(inviteRef(db, circle.inviteCode));
  batch.update(circleRef(db, circle.id), { inviteCode: code, updatedAt: serverTimestamp() });
  batch.set(inviteRef(db, code), { circleId: circle.id, createdAt: serverTimestamp() });
  await withTimeout(batch.commit());
  return code;
}

/** Unlinks a member's device (lost phone, reinstall) so they can join again. */
export async function unlinkMember(circle: Circle, member: Member): Promise<void> {
  if (!member.uid) return;
  const db = firestore();
  const batch = writeBatch(db);
  batch.delete(membershipRef(db, circle.id, member.uid));
  batch.update(doc(membersCol(db, circle.id), member.id), { uid: null });
  await withTimeout(batch.commit());
}

async function deleteInChunks(db: Firestore, refs: DocumentReference[]) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Deletes children first and the circle last, so a failure can simply be retried. */
export async function deleteCircle(circle: Circle): Promise<void> {
  const db = firestore();
  const cid = circle.id;
  const [receipts, payments, memberships, phones, contacts, members] = await Promise.all(
    ['receipts', 'payments', 'memberships', 'phones', 'contacts', 'members'].map((c) =>
      retry(() => getDocs(collection(db, 'circles', cid, c))),
    ),
  );
  await deleteInChunks(
    db,
    [receipts, payments, memberships, phones, contacts, members].flatMap((s) => s.docs.map((d) => d.ref)),
  );
  const batch = writeBatch(db);
  batch.delete(inviteRef(db, circle.inviteCode));
  batch.delete(circleRef(db, cid));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const paymentRef = (cid: string, periodId: string, memberId: string) =>
  doc(paymentsCol(firestore(), cid), paymentId(periodId, memberId));

const receiptRef = (cid: string, pid: string) => doc(firestore(), 'circles', cid, 'receipts', pid);

/**
 * Member: "I paid". Transfers (InstaPay / Vodafone Cash) carry a compressed
 * screenshot, written in the same batch so a claim never exists without it.
 */
export async function claimPayment(
  cid: string,
  periodId: string,
  memberId: string,
  uid: string,
  input: { method: PaymentMethod; receiptBase64?: string; note?: string },
) {
  const problem = validateClaim(input);
  if (problem) throw new AppError(`dory/${problem}`, arabicError({ code: `dory/${problem}` }));

  const db = firestore();
  const pid = paymentId(periodId, memberId);
  const withReceipt = requiresReceipt(input.method);
  const batch = writeBatch(db);
  if (withReceipt) {
    batch.set(receiptRef(cid, pid), {
      image: input.receiptBase64,
      memberId,
      periodId,
      uploadedBy: uid,
      createdAt: serverTimestamp(),
    });
  }
  batch.set(paymentRef(cid, periodId, memberId), {
    periodId,
    memberId,
    status: 'claimed',
    method: input.method,
    hasReceipt: withReceipt,
    claimedAt: new Date().toISOString(),
    claimedBy: uid,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 200) } : {}),
  });
  await withTimeout(batch.commit(), 30_000);
}

/** Member withdraws a claim, or admin rejects one / removes a recorded payment (with its screenshot). */
export async function removePayment(cid: string, payment: Pick<Payment, 'periodId' | 'memberId' | 'hasReceipt'>) {
  const db = firestore();
  const batch = writeBatch(db);
  batch.delete(paymentRef(cid, payment.periodId, payment.memberId));
  if (payment.hasReceipt) batch.delete(receiptRef(cid, paymentId(payment.periodId, payment.memberId)));
  await withTimeout(batch.commit());
}

/** Loads a transfer screenshot as a data URI (admin, or the member who sent it). */
export async function loadReceipt(cid: string, pid: string): Promise<string | null> {
  const snap = await retry(() => getDoc(receiptRef(cid, pid)));
  const image = snap.exists() ? String(snap.data().image ?? '') : '';
  return image ? `data:image/jpeg;base64,${image}` : null;
}

/**
 * Admin: confirm a member's claim (keeps their method and screenshot), or
 * record a payment received directly — pass the method in that case.
 */
export async function confirmPayment(
  cid: string,
  periodId: string,
  memberId: string,
  adminUid: string,
  method?: PaymentMethod,
) {
  await withTimeout(
    setDoc(
      paymentRef(cid, periodId, memberId),
      {
        periodId,
        memberId,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmedBy: adminUid,
        ...(method ? { method } : {}),
      },
      { merge: true },
    ),
  );
}

export async function confirmMany(
  cid: string,
  periodId: string,
  memberIds: string[],
  adminUid: string,
  method: PaymentMethod = 'cash',
) {
  const db = firestore();
  const now = new Date().toISOString();
  for (let i = 0; i < memberIds.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    memberIds.slice(i, i + BATCH_LIMIT).forEach((memberId) =>
      batch.set(
        doc(paymentsCol(db, cid), paymentId(periodId, memberId)),
        { periodId, memberId, status: 'confirmed', confirmedAt: now, confirmedBy: adminUid, method },
        { merge: true },
      ),
    );
    await withTimeout(batch.commit());
  }
}

/** Admin: where members should send InstaPay / Vodafone Cash transfers. */
export async function updatePayInfo(cid: string, info: PayInfo) {
  const clean: PayInfo = {};
  if (info.instapay?.trim()) clean.instapay = info.instapay.trim().slice(0, 60);
  if (info.vodafoneCash?.trim()) clean.vodafoneCash = info.vodafoneCash.trim().slice(0, 20);
  await withTimeout(updateDoc(circleRef(firestore(), cid), { payInfo: clean, updatedAt: serverTimestamp() }));
}

// ---------------------------------------------------------------------------
// Joining (member side)
// ---------------------------------------------------------------------------

export async function joinCircle(rawCode: string, rawPhone: string, uid: string): Promise<string> {
  const db = firestore();
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new AppError('dory/invalid-phone', arabicError({ code: 'dory/invalid-phone' }));

  const invite = await retry(() => getDoc(inviteRef(db, code)));
  if (!invite.exists()) throw new AppError('dory/invite-not-found', arabicError({ code: 'dory/invite-not-found' }));
  const cid = String(invite.data().circleId);

  // Already joined from this device?
  const existing = await retry(() => getDoc(membershipRef(db, cid, uid)));
  if (existing.exists()) return cid;

  const lookup = await retry(() => getDoc(phoneRef(db, cid, phone)));
  if (!lookup.exists()) throw new AppError('dory/phone-not-found', arabicError({ code: 'dory/phone-not-found' }));
  const memberId = String(lookup.data().memberId);

  const batch = writeBatch(db);
  batch.update(doc(membersCol(db, cid), memberId), { uid });
  batch.set(membershipRef(db, cid, uid), {
    uid,
    circleId: cid,
    memberId,
    inviteCode: code,
    joinedAt: serverTimestamp(),
  });
  try {
    await withTimeout(batch.commit(), 15_000);
  } catch (e) {
    // The member row is already linked to another device.
    if ((e as { code?: string }).code === 'permission-denied') {
      throw new AppError('dory/already-linked', arabicError({ code: 'dory/already-linked' }));
    }
    throw e;
  }
  return cid;
}

export async function leaveCircle(cid: string, memberId: string, uid: string): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.update(doc(membersCol(db, cid), memberId), { uid: null });
  batch.delete(membershipRef(db, cid, uid));
  await withTimeout(batch.commit());
}
