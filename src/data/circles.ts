import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
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
  METHOD_LABEL,
  newId,
  isCircleOpen,
  generateInviteCode,
  initialPeriods,
  normalizePayAccount,
  normalizePhone,
  paymentId,
  syncPeriodsWithMembers,
  type Circle,
  type CircleDraft,
  type Frequency,
  requiresReceipt,
  validateClaim,
  type Announcement,
  type Member,
  type PayInfo,
  type Payment,
  type PaymentMethod,
  type PayoutRequest,
  type Period,
  validatePayoutRequest,
  payoutNeedsReceipt,
  setPaidOut,
  cleanGroupLink,
} from '@/core';

import { AppError, arabicError, retry, withTimeout } from './errors';
import { firestore } from './firebase';
import { circleNameOf, memberNameOf, myPushToken, pushToAdmin, pushToMembers, pushToUids, sendPush, uidOfMember } from './push';

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
    whatsappGroup: d.whatsappGroup ?? undefined,
    ownerMemberId: d.ownerMemberId ?? undefined,
    slots: typeof d.slots === 'number' ? d.slots : undefined,
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
    receiptCheck: data.receiptCheck === 'auto' || data.receiptCheck === 'manual' ? data.receiptCheck : undefined,
    claimedAt: data.claimedAt ?? undefined,
    confirmedAt: data.confirmedAt ?? undefined,
    note: data.note ?? undefined,
  };
}

function memberDoc(m: Member, order: number) {
  return { name: m.name.trim().slice(0, 60), uid: m.uid ?? null, order };
}

const phoneOf = (m: Member | undefined) => (m?.phone ? normalizePayAccount(m.phone) : null);
/** Legacy phone → member lookups only exist for numbers, not InstaPay addresses. */
const isNumber = (v: string | null): v is string => !!v && /^\d+$/.test(v);

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
    ...(draft.ownerFirst && members[0] ? { ownerMemberId: members[0].id } : {}),
    ...(draft.slots ? { slots: draft.slots } : {}),
    ...(draft.payInstapay && normalizePayAccount(draft.payInstapay)
      ? { payInfo: { instapay: normalizePayAccount(draft.payInstapay) } }
      : {}),
  });
  members.forEach((m, i) => {
    const phone = phoneOf(m);
    batch.set(doc(membersCol(db, ref.id), m.id), { ...memberDoc(m, i), createdAt: serverTimestamp() });
    batch.set(doc(contactsCol(db, ref.id), m.id), { phone });
    if (isNumber(phone)) batch.set(phoneRef(db, ref.id, phone), { memberId: m.id });
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
  settings?: { name: string; installment: number; frequency: Frequency; startDate: string; slots?: number },
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
    if (isNumber(oldPhone) && (!now || phoneOf(now) !== oldPhone)) removedPhones.add(oldPhone);
  }
  for (const m of withIds) {
    const phone = phoneOf(m);
    if (isNumber(phone) && phone !== phoneOf(before.get(m.id))) addedPhones.set(phone, m.id);
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
      ...(settings.slots ? { slots: settings.slots } : {}),
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
  // Unlist it first so nobody asks to join a circle that's going away.
  await withTimeout(deleteDoc(directoryRef(firestore(), circle.id))).catch(() => {});
  const db = firestore();
  const cid = circle.id;
  const [joinRequests, announcements, payoutReceipts, payouts, receipts, payments, memberships, phones, contacts, members] = await Promise.all(
    ['joinRequests', 'announcements', 'payoutReceipts', 'payouts', 'receipts', 'payments', 'memberships', 'phones', 'contacts', 'members'].map((c) =>
      retry(() => getDocs(collection(db, 'circles', cid, c))),
    ),
  );
  const inboxes = await Promise.all(
    circle.members.map((m) => retry(() => getDocs(inboxCol(db, cid, m.id))).catch(() => null)),
  );
  await deleteInChunks(
    db,
    inboxes.flatMap((snap) => (snap ? snap.docs.map((d) => d.ref) : [])),
  );
  await deleteInChunks(
    db,
    [joinRequests, announcements, payoutReceipts, payouts, receipts, payments, memberships, phones, contacts, members].flatMap((s) => s.docs.map((d) => d.ref)),
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
  input: { method: PaymentMethod; receiptBase64?: string; note?: string; receiptCheck?: 'auto' | 'manual' },
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
    ...(withReceipt ? { receiptCheck: input.receiptCheck ?? 'manual' } : {}),
    claimedAt: new Date().toISOString(),
    claimedBy: uid,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 200) } : {}),
  });
  await withTimeout(batch.commit(), 30_000);
  void (async () => {
    const [circleName, who] = await Promise.all([circleNameOf(cid), memberNameOf(cid, memberId)]);
    await pushToAdmin(cid, {
      title: `💵 ${who} بيقول إنه دفع`,
      body: `${circleName}: ${METHOD_LABEL[input.method]}${
        withReceipt ? (input.receiptCheck === 'auto' ? ' — الإيصال مطابق ✓' : ' — اتأكد إن الفلوس وصلت حسابك') : ''
      }. ادخل أكّد الاستلام.`,
    });
  })();
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
  void (async () => {
    const [circleName, uid] = await Promise.all([circleNameOf(cid), uidOfMember(cid, memberId)]);
    await pushToUids(cid, [uid], { title: '✅ اتأكد استلام قسطك', body: `صاحب جمعية "${circleName}" أكّد إنه استلم قسطك.` });
  })();
}

/**
 * Admin records a transfer the member made straight to them (InstaPay /
 * Vodafone Cash) — always with the transfer screenshot, never without.
 */
export async function recordTransferPayment(
  cid: string,
  periodId: string,
  memberId: string,
  adminUid: string,
  input: { method: PaymentMethod; receiptBase64: string; receiptCheck: 'auto' | 'manual' },
) {
  if (!requiresReceipt(input.method) || !input.receiptBase64) {
    throw new AppError('dory/receipt-required', arabicError({ code: 'dory/receipt-required' }));
  }
  const db = firestore();
  const pid = paymentId(periodId, memberId);
  const batch = writeBatch(db);
  batch.set(receiptRef(cid, pid), {
    image: input.receiptBase64,
    memberId,
    periodId,
    uploadedBy: adminUid,
    createdAt: serverTimestamp(),
  });
  batch.set(paymentRef(cid, periodId, memberId), {
    periodId,
    memberId,
    status: 'confirmed',
    method: input.method,
    hasReceipt: true,
    receiptCheck: input.receiptCheck,
    confirmedAt: new Date().toISOString(),
    confirmedBy: adminUid,
  });
  await withTimeout(batch.commit(), 30_000);
  void (async () => {
    const [circleName, uid] = await Promise.all([circleNameOf(cid), uidOfMember(cid, memberId)]);
    await pushToUids(cid, [uid], { title: '✅ اتأكد استلام قسطك', body: `صاحب جمعية "${circleName}" أكّد إنه استلم قسطك.` });
  })();
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
  void (async () => {
    const circleName = await circleNameOf(cid);
    const uids = await Promise.all(memberIds.map((m) => uidOfMember(cid, m)));
    await pushToUids(cid, uids, { title: '✅ اتأكد استلام قسطك', body: `صاحب جمعية "${circleName}" أكّد إنه استلم قسطك.` });
  })();
}

/** Admin: where members should send InstaPay / Vodafone Cash transfers. */
export async function updatePayInfo(cid: string, info: PayInfo) {
  const clean: PayInfo = {};
  if (info.instapay?.trim()) clean.instapay = info.instapay.trim().slice(0, 60);
  if (info.vodafoneCash?.trim()) clean.vodafoneCash = info.vodafoneCash.trim().slice(0, 20);
  await withTimeout(updateDoc(circleRef(firestore(), cid), { payInfo: clean, updatedAt: serverTimestamp() }));
}

/** Admin ("حسابي"): the InstaPay account members transfer to, in every circle they run. */
export async function setInstapayForMyCircles(uid: string, instapay: string): Promise<number> {
  const db = firestore();
  const snap = await retry(() => getDocs(query(collection(db, 'circles'), where('adminUid', '==', uid))));
  const value = instapay.trim().slice(0, 60);
  await Promise.all(
    snap.docs.map((d) =>
      withTimeout(updateDoc(d.ref, { 'payInfo.instapay': value, updatedAt: serverTimestamp() })),
    ),
  );
  return snap.size;
}

/** The InstaPay account saved on the admin's circles (first one found). */
export async function myAdminInstapay(uid: string): Promise<string> {
  try {
    const snap = await getDocs(query(collection(firestore(), 'circles'), where('adminUid', '==', uid)));
    for (const d of snap.docs) {
      const v = d.data().payInfo?.instapay;
      if (typeof v === 'string' && v) return v;
    }
  } catch {
    // offline
  }
  return '';
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

// ---------------------------------------------------------------------------
// Public directory of open circles + join requests the admin approves in the app
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  id: string;
  name: string;
  adminName: string;
  installment: number;
  frequency: Frequency;
  startDate: string;
  memberCount: number;
  slots?: number;
  open: boolean;
}

const directoryRef = (db: Firestore, cid: string) => doc(db, 'directory', cid);

function directoryDoc(circle: Circle, adminName: string) {
  return {
    name: circle.name.slice(0, 60),
    adminName: adminName.trim().slice(0, 60),
    installment: circle.installment,
    frequency: circle.frequency,
    startDate: circle.startDate,
    memberCount: circle.members.length,
    slots: circle.slots ?? null,
    open: isCircleOpen(circle),
    // So people asking to join can notify the admin.
    adminPush: myPushToken() ?? null,
    updatedAt: serverTimestamp(),
  };
}

/** Admin: publish/refresh the circle's public listing (what people see before joining). */
export async function syncDirectory(circle: Circle, adminName: string) {
  await withTimeout(setDoc(directoryRef(firestore(), circle.id), directoryDoc(circle, adminName)), 15_000);
}

/**
 * Anyone with the invite code: the circle it belongs to (its public card).
 * There's no public list — a circle is only found through its code.
 */
export async function findCircleByCode(rawCode: string): Promise<DirectoryEntry> {
  const db = firestore();
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const invite = await retry(() => getDoc(inviteRef(db, code)));
  if (!invite.exists()) throw new AppError('dory/invite-not-found', arabicError({ code: 'dory/invite-not-found' }));
  const cid = String(invite.data().circleId);
  const snap = await retry(() => getDoc(directoryRef(db, cid)));
  if (!snap.exists()) throw new AppError('dory/circle-closed', arabicError({ code: 'dory/circle-closed' }));
  const x = snap.data();
  const entry: DirectoryEntry = {
    id: cid,
    name: String(x.name ?? ''),
    adminName: String(x.adminName ?? ''),
    installment: Number(x.installment ?? 0),
    frequency: x.frequency as Frequency,
    startDate: String(x.startDate ?? ''),
    memberCount: Number(x.memberCount ?? 0),
    slots: typeof x.slots === 'number' ? x.slots : undefined,
    open: x.open === true,
  };
  return entry;
}

export interface JoinRequest {
  uid: string;
  name: string;
  /** Mobile number (international digits) — the member's identity in the circle. */
  phone?: string;
  /** InstaPay mobile number or address the member entered (optional). */
  payAccount?: string;
  /** The requester's push token, so they hear about approval/rejection. */
  pushToken?: string;
  createdAt?: string;
}

const joinRequestsCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'joinRequests');

/** Is this mobile number already a member of the circle? (Then it signs in instead of asking again.) */
export async function isPhoneRegistered(cid: string, rawPhone: string): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;
  const snap = await retry(() => getDoc(phoneRef(firestore(), cid, phone)));
  return snap.exists();
}

/** Member: ask to join a circle from the directory with my own details. */
export async function requestJoin(
  cid: string,
  input: { name: string; phone: string; payAccount?: string },
  uid: string,
): Promise<{ joined: boolean }> {
  const db = firestore();
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) throw new AppError('dory/name-missing', arabicError({ code: 'dory/name-missing' }));
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('dory/invalid-phone', arabicError({ code: 'dory/invalid-phone' }));
  if (await isPhoneRegistered(cid, phone)) throw new AppError('dory/phone-taken', arabicError({ code: 'dory/phone-taken' }));
  const raw = input.payAccount?.trim() ?? '';
  const payAccount = raw ? normalizePayAccount(raw) : null;
  if (raw && !payAccount) throw new AppError('dory/instapay-invalid', arabicError({ code: 'dory/instapay-invalid' }));

  const existing = await retry(() => getDoc(membershipRef(db, cid, uid)));
  if (existing.exists()) return { joined: true };

  await withTimeout(
    setDoc(doc(joinRequestsCol(db, cid), uid), {
      uid,
      name,
      phone,
      ...(payAccount ? { payAccount } : {}),
      ...(myPushToken() ? { pushToken: myPushToken() } : {}),
      createdAt: serverTimestamp(),
    }),
    15_000,
  );
  void (async () => {
    try {
      const card = await getDoc(directoryRef(db, cid));
      const adminPush = card.exists() ? (card.data().adminPush as string | undefined) : undefined;
      await sendPush([adminPush], {
        circleId: cid,
        title: `🙋 طلب انضمام من ${name}`,
        body: `عايز يدخل جمعية "${card.exists() ? String(card.data().name ?? '') : ''}". ادخل وافق أو ارفض.`,
      });
    } catch {
      // best effort
    }
  })();
  return { joined: false };
}

/** Member: watch my own pending request ('pending' | 'approved' | 'gone'). */
export function watchMyJoin(
  cid: string,
  uid: string,
  onData: (status: 'pending' | 'approved' | 'gone') => void,
): Unsubscribe {
  const db = firestore();
  let requested: boolean | undefined;
  let member: boolean | undefined;
  const emit = () => {
    if (requested === undefined || member === undefined) return;
    onData(member ? 'approved' : requested ? 'pending' : 'gone');
  };
  const unsubs = [
    onSnapshot(
      doc(joinRequestsCol(db, cid), uid),
      (s) => {
        requested = s.exists();
        emit();
      },
      () => {
        requested = false;
        emit();
      },
    ),
    onSnapshot(
      membershipRef(db, cid, uid),
      (s) => {
        member = s.exists();
        emit();
      },
      () => {
        member = false;
        emit();
      },
    ),
  ];
  return () => unsubs.forEach((u) => u());
}

/** Member: withdraw my request. */
export async function cancelJoinRequest(cid: string, uid: string) {
  await withTimeout(deleteDoc(doc(joinRequestsCol(firestore(), cid), uid)));
}

/** Admin: live list of people asking to join. */
export function watchJoinRequests(cid: string, onData: (items: JoinRequest[]) => void): Unsubscribe {
  return onSnapshot(
    joinRequestsCol(firestore(), cid),
    (s) =>
      onData(
        s.docs
          .map((d) => {
            const data = d.data();
            const ts = data.createdAt as { toDate?: () => Date } | undefined;
            return {
              uid: d.id,
              name: String(data.name ?? ''),
              phone: data.phone ? String(data.phone) : undefined,
              payAccount: data.payAccount ? String(data.payAccount) : undefined,
              pushToken: data.pushToken ? String(data.pushToken) : undefined,
              createdAt: ts?.toDate?.().toISOString(),
            };
          })
          .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')),
      ),
    () => onData([]),
  );
}

/**
 * Admin: accept a request. By default the requester becomes a NEW member with
 * the details they entered and gets the next turn in the timeline; pass
 * `existingMemberId` to link them to a row that's already in the table.
 */
export async function approveJoin(circle: Circle, request: JoinRequest, existingMemberId?: string) {
  const db = firestore();
  const cid = circle.id;

  if (request.phone) {
    const taken = await retry(() => getDoc(phoneRef(db, cid, request.phone!)));
    if (taken.exists() && String(taken.data().memberId) !== existingMemberId) {
      throw new AppError('dory/phone-taken', arabicError({ code: 'dory/phone-taken' }));
    }
  }

  if (existingMemberId) {
    const batch = writeBatch(db);
    batch.update(doc(membersCol(db, cid), existingMemberId), { uid: request.uid });
    if (request.phone) batch.set(phoneRef(db, cid, request.phone), { memberId: existingMemberId });
    if (request.payAccount) batch.set(doc(contactsCol(db, cid), existingMemberId), { phone: request.payAccount });
    batch.set(membershipRef(db, cid, request.uid), {
      uid: request.uid,
      circleId: cid,
      memberId: existingMemberId,
      inviteCode: circle.inviteCode,
      joinedAt: serverTimestamp(),
    });
    batch.delete(doc(joinRequestsCol(db, cid), request.uid));
    await withTimeout(batch.commit(), 15_000);
    void sendPush([request.pushToken], { circleId: cid, title: '🎉 اتقبلت في الجمعية', body: `صاحب جمعية "${circle.name}" وافق على طلبك. افتح دوري وشوف دورك.` });
    return;
  }

  const memberId = doc(membersCol(db, cid)).id;
  await withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(circleRef(db, cid));
      if (!snap.exists()) throw new AppError('not-found', arabicError({ code: 'not-found' }));
      const data = snap.data();
      if (request.phone) {
        const taken = await tx.get(phoneRef(db, cid, request.phone));
        if (taken.exists()) throw new AppError('dory/phone-taken', arabicError({ code: 'dory/phone-taken' }));
      }
      const count = Number(data.memberCount ?? circle.members.length);
      const slots = typeof data.slots === 'number' ? data.slots : undefined;
      if (slots && count >= slots) throw new AppError('dory/circle-full', arabicError({ code: 'dory/circle-full' }));
      const periods = [...((data.periods ?? []) as Period[]), { id: newId('p'), kind: 'payout' as const, recipientId: memberId }];

      tx.set(doc(membersCol(db, cid), memberId), {
        name: request.name,
        uid: request.uid,
        order: circle.members.length,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(contactsCol(db, cid), memberId), { phone: request.payAccount ?? request.phone ?? null });
      // The number is the member's key for signing back in later (code + number).
      if (request.phone) tx.set(phoneRef(db, cid, request.phone), { memberId });
      tx.set(membershipRef(db, cid, request.uid), {
        uid: request.uid,
        circleId: cid,
        memberId,
        inviteCode: circle.inviteCode,
        joinedAt: serverTimestamp(),
      });
      tx.delete(doc(joinRequestsCol(db, cid), request.uid));
      tx.update(circleRef(db, cid), { periods: cleanPeriods(periods), memberCount: count + 1, updatedAt: serverTimestamp() });
    }),
    20_000,
  );
  void sendPush([request.pushToken], { circleId: cid, title: '🎉 اتقبلت في الجمعية', body: `صاحب جمعية "${circle.name}" وافق على طلبك. افتح دوري وشوف دورك.` });
}

/** Admin: reject a request. */
export async function rejectJoin(cid: string, requesterUid: string, pushToken?: string) {
  await withTimeout(deleteDoc(doc(joinRequestsCol(firestore(), cid), requesterUid)));
  void sendPush([pushToken], { title: 'طلب الانضمام ما اتقبلش', body: 'صاحب الجمعية ما وافقش على طلبك. اتأكد معاه من الكود واسمك.' });
}

/**
 * Member signs out: their rows are freed (name, turn and payments stay), so
 * they can come back on any phone with the invite code + their number.
 */
export async function releaseMyMemberships(uid: string, refs: { id: string; memberId?: string }[]): Promise<void> {
  await Promise.all(
    refs.filter((r) => r.memberId).map((r) => leaveCircle(r.id, r.memberId!, uid).catch(() => {})),
  );
}

/**
 * Admin: members who joined before numbers were their sign-in key get a
 * number → member lookup from the number saved on their row, so they can
 * sign back in with code + number too.
 */
export async function backfillPhones(circle: Circle): Promise<void> {
  const db = firestore();
  const existing = await getDocs(collection(db, 'circles', circle.id, 'phones'));
  const taken = new Set(existing.docs.map((d) => d.id));
  const linked = new Set(existing.docs.map((d) => String(d.data().memberId)));
  const batch = writeBatch(db);
  let n = 0;
  for (const m of circle.members) {
    if (linked.has(m.id) || !m.phone || m.phone.includes('@')) continue;
    const phone = normalizePhone(m.phone);
    if (!phone || taken.has(phone)) continue;
    taken.add(phone);
    batch.set(phoneRef(db, circle.id, phone), { memberId: m.id });
    n++;
  }
  if (n) await withTimeout(batch.commit());
}

export async function leaveCircle(cid: string, memberId: string, uid: string): Promise<void> {
  const db = firestore();
  const batch = writeBatch(db);
  batch.update(doc(membersCol(db, cid), memberId), { uid: null });
  batch.delete(membershipRef(db, cid, uid));
  await withTimeout(batch.commit());
}

// ---------------------------------------------------------------------------
// Payouts: the turn's recipient asks how to be paid, the admin decides and pays
// ---------------------------------------------------------------------------

const payoutsCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'payouts');
const payoutRef = (db: Firestore, cid: string, periodId: string) => doc(payoutsCol(db, cid), periodId);
const payoutReceiptRef = (db: Firestore, cid: string, periodId: string) =>
  doc(db, 'circles', cid, 'payoutReceipts', periodId);

function payoutFromDoc(data: DocumentData): PayoutRequest {
  return {
    periodId: data.periodId,
    recipientId: data.recipientId,
    status: data.status,
    method: data.method ?? 'cash',
    account: data.account ?? undefined,
    note: data.note ?? undefined,
    requestedAt: data.requestedAt ?? undefined,
    adminNote: data.adminNote ?? undefined,
    decidedAt: data.decidedAt ?? undefined,
    paidAt: data.paidAt ?? undefined,
    hasReceipt: data.hasReceipt === true,
    receivedAt: data.receivedAt ?? undefined,
    disputeNote: data.disputeNote ?? undefined,
  };
}

/**
 * Admin: every payout request in the circle. Member: only their own (the
 * rules hide other members' account numbers).
 */
export function watchPayouts(
  cid: string,
  viewer: { role: 'admin' } | { role: 'member'; memberId: string },
  onData: (payouts: PayoutRequest[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  const db = firestore();
  const q =
    viewer.role === 'admin'
      ? payoutsCol(db, cid)
      : query(payoutsCol(db, cid), where('recipientId', '==', viewer.memberId));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => payoutFromDoc(d.data()))),
    (e) => onError(arabicError(e)),
  );
}

function checkAccount(method: PaymentMethod, account?: string) {
  const problem = validatePayoutRequest(method, account);
  if (problem) throw new AppError(`dory/${problem}`, arabicError({ code: `dory/${problem}` }));
}

/** Recipient: "pay my turn by …". Creates or updates the request until it's approved. */
export async function requestPayout(
  cid: string,
  periodId: string,
  recipientId: string,
  uid: string,
  input: { method: PaymentMethod; account?: string; note?: string },
) {
  checkAccount(input.method, input.account);
  const transfer = input.method !== 'cash';
  await withTimeout(
    setDoc(
      payoutRef(firestore(), cid, periodId),
      {
        periodId,
        recipientId,
        status: 'requested',
        method: input.method,
        account: transfer ? input.account!.trim().slice(0, 60) : deleteField(),
        note: input.note?.trim() ? input.note.trim().slice(0, 200) : deleteField(),
        requestedAt: new Date().toISOString(),
        requestedBy: uid,
      },
      { merge: true },
    ),
  );
  void (async () => {
    const [circleName, who] = await Promise.all([circleNameOf(cid), memberNameOf(cid, recipientId)]);
    await pushToAdmin(cid, { title: `💼 ${who} طلب طريقة القبض`, body: `${circleName}: ادخل وافق أو عدّل.` });
  })();
}

/** Admin: approve (optionally changing method/account) or reject a request. */
export async function decidePayout(
  cid: string,
  request: PayoutRequest,
  adminUid: string,
  decision: { status: 'approved' | 'rejected'; method?: PaymentMethod; account?: string; adminNote?: string },
) {
  const method = decision.method ?? request.method;
  const account = decision.account ?? request.account;
  if (decision.status === 'approved') checkAccount(method, account);
  await withTimeout(
    setDoc(
      payoutRef(firestore(), cid, request.periodId),
      {
        periodId: request.periodId,
        recipientId: request.recipientId,
        status: decision.status,
        method,
        account: method === 'cash' || !account ? deleteField() : account.trim().slice(0, 60),
        adminNote: decision.adminNote?.trim() ? decision.adminNote.trim().slice(0, 200) : deleteField(),
        decidedAt: new Date().toISOString(),
        decidedBy: adminUid,
      },
      { merge: true },
    ),
  );
}

/**
 * Admin hands over the pot: marks the period paid out, records how, and
 * attaches the transfer screenshot — all in one transaction.
 */
export async function markPayoutPaid(
  cid: string,
  periodId: string,
  recipientId: string,
  adminUid: string,
  input: {
    method: PaymentMethod;
    account?: string;
    receiptBase64?: string;
    adminNote?: string;
    /** The organizer's own turn: the money is already with them, so it's received at once. */
    self?: boolean;
  },
) {
  if (input.method !== 'cash') checkAccount(input.method, input.account);
  const needsReceipt = payoutNeedsReceipt(input.method);
  if (needsReceipt && !input.receiptBase64) {
    throw new AppError('dory/receipt-missing', arabicError({ code: 'dory/payout-receipt-missing' }));
  }
  const db = firestore();
  await withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(circleRef(db, cid));
      if (!snap.exists()) throw new AppError('not-found', arabicError({ code: 'not-found' }));
      const periods = setPaidOut((snap.data().periods ?? []) as Period[], periodId, true);
      if (needsReceipt) {
        tx.set(payoutReceiptRef(db, cid, periodId), {
          image: input.receiptBase64,
          recipientId,
          periodId,
          uploadedBy: adminUid,
          createdAt: serverTimestamp(),
        });
      }
      tx.set(
        payoutRef(db, cid, periodId),
        {
          periodId,
          recipientId,
          status: input.self ? 'received' : 'paid',
          method: input.method,
          account: input.method === 'cash' || !input.account ? deleteField() : input.account.trim().slice(0, 60),
          adminNote: input.adminNote?.trim() ? input.adminNote.trim().slice(0, 200) : deleteField(),
          paidAt: new Date().toISOString(),
          decidedBy: adminUid,
          hasReceipt: needsReceipt,
          // A fresh transfer needs a fresh confirmation from the recipient.
          receivedAt: input.self ? new Date().toISOString() : deleteField(),
          disputeNote: deleteField(),
        },
        { merge: true },
      );
      tx.update(circleRef(db, cid), { periods: cleanPeriods(periods), updatedAt: serverTimestamp() });
    }),
    30_000,
  );
  if (!input.self) {
    void (async () => {
      const [circleName, uid] = await Promise.all([circleNameOf(cid), uidOfMember(cid, recipientId)]);
      await pushToUids(cid, [uid], {
        title: '🎉 مبروك! قبضت جمعيتك',
        body: `صاحب جمعية "${circleName}" سلّمك القبض. افتح دوري وأكّد الاستلام.`,
      });
    })();
  }
}

/** Admin: undo a payout recorded by mistake. */
export async function undoPayout(cid: string, periodId: string, hadReceipt: boolean) {
  const db = firestore();
  await withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(circleRef(db, cid));
      if (!snap.exists()) throw new AppError('not-found', arabicError({ code: 'not-found' }));
      const periods = setPaidOut((snap.data().periods ?? []) as Period[], periodId, false);
      const payout = await tx.get(payoutRef(db, cid, periodId));
      if (payout.exists()) {
        tx.update(payoutRef(db, cid, periodId), {
          status: 'approved',
          paidAt: deleteField(),
          hasReceipt: false,
          receivedAt: deleteField(),
          disputeNote: deleteField(),
        });
      }
      if (hadReceipt) tx.delete(payoutReceiptRef(db, cid, periodId));
      tx.update(circleRef(db, cid), { periods: cleanPeriods(periods), updatedAt: serverTimestamp() });
    }),
  );
}

export async function loadPayoutReceipt(cid: string, periodId: string): Promise<string | null> {
  const snap = await retry(() => getDoc(payoutReceiptRef(firestore(), cid, periodId)));
  const image = snap.exists() ? String(snap.data().image ?? '') : '';
  return image ? `data:image/jpeg;base64,${image}` : null;
}

/** Recipient: "the money arrived ✓". */
export async function confirmPayoutReceived(cid: string, periodId: string) {
  await withTimeout(
    setDoc(
      payoutRef(firestore(), cid, periodId),
      { status: 'received', receivedAt: new Date().toISOString(), disputeNote: deleteField() },
      { merge: true },
    ),
  );
}

/** Recipient: "it didn't arrive" — the admin gets notified with the note. */
export async function disputePayout(cid: string, periodId: string, note: string) {
  await withTimeout(
    setDoc(
      payoutRef(firestore(), cid, periodId),
      { status: 'disputed', disputeNote: note.trim().slice(0, 200) || 'الفلوس ما وصلتش' },
      { merge: true },
    ),
  );
}

// ---------------------------------------------------------------------------
// WhatsApp group & announcements
// ---------------------------------------------------------------------------

/** Admin: save (or clear with null) the circle's WhatsApp group invite link. */
export async function updateWhatsappGroup(cid: string, raw: string | null) {
  const link = raw === null ? null : cleanGroupLink(raw);
  if (raw !== null && !link) throw new AppError('dory/invalid-group-link', arabicError({ code: 'dory/invalid-group-link' }));
  await withTimeout(
    updateDoc(circleRef(firestore(), cid), { whatsappGroup: link ?? deleteField(), updatedAt: serverTimestamp() }),
  );
}

const announcementsCol = (db: Firestore, cid: string) => collection(db, 'circles', cid, 'announcements');

export function watchAnnouncements(
  cid: string,
  onData: (items: Announcement[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return onSnapshot(
    query(announcementsCol(firestore(), cid), orderBy('createdAt', 'desc'), limit(50)),
    { includeMetadataChanges: false },
    (snap) =>
      onData(
        snap.docs.map((d) => ({
          id: d.id,
          title: String(d.data().title ?? ''),
          body: String(d.data().body ?? ''),
          // Pending server timestamps are null until the write is acknowledged.
          createdAt: d.data({ serverTimestamps: 'estimate' }).createdAt?.toDate?.().toISOString() ?? new Date().toISOString(),
        })),
      ),
    (e) => onError(arabicError(e)),
  );
}

/**
 * Admin: post a message. With `to` (member ids) it goes only to those members
 * (their private inbox + a push to their phones); otherwise to everyone.
 */
export async function postAnnouncement(
  cid: string,
  uid: string,
  title: string,
  body: string,
  to?: { memberIds: string[]; uids: (string | null | undefined)[] },
) {
  const data = {
    title: title.trim().slice(0, 80),
    body: body.trim().slice(0, 1000),
    createdBy: uid,
    createdAt: serverTimestamp(),
  };
  const db = firestore();
  if (to) {
    if (to.memberIds.length === 0) return;
    const batch = writeBatch(db);
    for (const mid of to.memberIds) batch.set(doc(inboxCol(db, cid, mid)), data);
    await withTimeout(batch.commit());
  } else {
    await withTimeout(setDoc(doc(announcementsCol(db, cid)), data));
  }
  void (async () => {
    const circleName = await circleNameOf(cid);
    const msg = {
      title: `📢 ${circleName}: ${data.title}`,
      body: data.body.slice(0, 180) || 'رسالة جديدة من صاحب الجمعية',
      channelId: 'announcements' as const,
    };
    if (to) await pushToUids(cid, to.uids, msg);
    else await pushToMembers(cid, uid, msg);
  })();
}

/** Member deletes one of their private messages (id as returned by watchInbox). */
export async function deleteInboxMessage(cid: string, memberId: string, id: string) {
  await withTimeout(deleteDoc(doc(inboxCol(firestore(), cid, memberId), id.replace(/^inbox-/, ''))));
}

const inboxCol = (db: Firestore, cid: string, memberId: string) => collection(db, 'circles', cid, 'inbox', memberId, 'items');

/** A member's private messages from the admin. */
export function watchInbox(
  cid: string,
  memberId: string,
  onData: (items: Announcement[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return onSnapshot(
    query(inboxCol(firestore(), cid, memberId), orderBy('createdAt', 'desc'), limit(30)),
    (snap) =>
      onData(
        snap.docs.map((d) => ({
          id: `inbox-${d.id}`,
          title: String(d.data().title ?? ''),
          body: String(d.data().body ?? ''),
          createdAt: d.data({ serverTimestamps: 'estimate' }).createdAt?.toDate?.().toISOString() ?? new Date().toISOString(),
          private: true,
        })),
      ),
    (e) => onError(arabicError(e)),
  );
}

export async function deleteAnnouncement(cid: string, id: string) {
  await withTimeout(deleteDoc(doc(announcementsCol(firestore(), cid), id)));
}
