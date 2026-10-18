import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, I18nManager, Linking as RNLinking, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  circleInviteMessage,
  protectionCodeMessage,
  normalizePhone,
  normalizePayAccount,
  INSTAPAY_ADDRESS,
  smsUrl,
  whatsappUrl,
  addExtraInstallment,
  addExtraTurn,
  currentIndex,
  assignRecipients,
  openPayouts,
  extraTurnSlots,
  roundOf,
  orderByRounds,
  addBonus,
  speedUp,
  isSpedUp,
  endDate,
  type SpeedUp,
  drawablePayouts,
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  isCircleOpen,
  movePeriod,
  overview,
  parseAmount,
  payoutNet,
  payoutPot,
  pendingApprovals,
  periodSummary,
  periodTitle,
  postpone,
  removePeriod,
  timeline,
  periodDue,
  upcomingExtras,
  cadenceLabel,
  clearBonus,
  todayISO,
  findPayment,
  METHOD_LABEL,
  methodOf,
  PAYMENT_METHODS,
  type Circle,
  type Member,
  type Payment,
  type TimelineEntry,
  type PayoutRequest,
  type PaymentMethod,
  PAYOUT_STATUS_LABEL,
  addDays,
  addMonths,
  deferralOf,
  setDeferral,
  circleCompletion,
  earlyPayable,
  speedUpByAmount,
  pullTurnsTo,
  extraDateChoices,
  extraDates,
  clearExtraDate,
} from '@/core';
import {
  saveCircle,
  issueFirstLoginCode,
  hasLoginCode,
  clearFirstLoginCode,
  firstLoginCodeOf,
  backfillPhones,
  syncDirectory,
  approveJoin,
  rejectJoin,
  useJoinRequests,
  type JoinRequest,
  postAnnouncement,
  confirmMany,
  confirmPayment,
  confirmMemberPeriods,
  loadPayoutReceipt,
  loadReceipt,
  usePayouts,
  mutatePeriods,
  removePayment,
  rotateInviteCode,
  unlinkMember,
  updatePayInfo,
} from '@/data';
import { ActionTile, Badge, Button, Card, Chip, Field, IconButton, ProgressBar, Row, Segmented, Text, tap } from "@/ui/components";
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { TurnRing } from '@/ui/TurnRing';
import { Celebration } from '@/ui/Celebration';
import { KeyboardScreen } from '@/ui/KeyboardScreen';
import { colors, radius, space } from '@/ui/theme';

import { DrawWheel } from './DrawWheel';
import { MessagesTab } from './Messaging';
import { AdminPayoutSheet, describePayout, PAYOUT_TONE } from './PayoutSheets';
import { AdminRecordTransferSheet, METHOD_COLOR, METHOD_ICON } from './PaySheet';
import { ReceiptViewer } from './ReceiptViewer';
import { TurnsSheet } from './TurnsSheet';
import { useAppSession } from '@/data/session';
import { ensurePushToken } from '@/notifications';
import { alert, type DialogButton } from '@/ui/dialog';

export type AdminTab = 'collect' | 'schedule' | 'members' | 'messages';

export function AdminView({
  circle,
  payments,
  uid,
  initialTab = 'collect',
}: {
  circle: Circle;
  payments: Payment[];
  uid: string;
  initialTab?: AdminTab;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const joinRequests = useJoinRequests(circle.id);
  const { user } = useAppSession();

  // Keep the public "join a circle" listing in step with the circle (also lists older circles).
  const listingKey = JSON.stringify([
    circle.name,
    circle.installment,
    circle.frequency,
    circle.startDate,
    circle.members.length,
    circle.slots ?? null,
    user?.displayName ?? '',
  ]);
  useEffect(() => {
    // Wait for this phone's push token so join requests can notify the admin.
    ensurePushToken()
      .catch(() => null)
      .then(() => syncDirectory(circle, user?.displayName ?? ''))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingKey]);
  const payouts = usePayouts(circle.id, 'admin', undefined);
  const o = overview(circle, payments);
  const completion = circleCompletion(circle, payments);
  // Mirror each recipient's "I got my money" onto the schedule, so everyone can see when the circle is truly over.
  const receivedKey = payouts.map((r) => `${r.periodId}:${r.status}`).sort().join('|');
  useEffect(() => {
    const got = new Set(payouts.filter((r) => r.status === 'received').map((r) => r.periodId));
    const stale = circle.periods.some(
      (p) => p.kind === 'payout' && p.paidOut && !!p.received !== got.has(p.id),
    );
    if (!stale) return;
    mutatePeriods(circle.id, (ps) =>
      ps.map((p) => (p.kind === 'payout' && p.paidOut ? { ...p, received: got.has(p.id) } : p)),
    ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle.id, receivedKey, circle.periods.map((p) => `${p.id}:${p.paidOut ? 1 : 0}:${p.received ? 1 : 0}`).join('|')]);
  const phonesKey = circle.members.map((m) => `${m.id}:${m.phone ?? ''}:${m.uid ? 1 : 0}`).join('|');
  useEffect(() => {
    backfillPhones(circle).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle.id, phonesKey]);
  const openPayoutRequests = payouts.filter((r) => r.status === 'requested' || r.status === 'disputed').length;
  const [showTurns, setShowTurns] = useState(false);
  // The amounts shown up top follow the turn being collected now (or the next one), extras included.
  const heroEntry = timeline(circle).find((e) => e.period.kind === 'payout' && !e.period.paidOut && e.index >= Math.max(0, o.current));
  const heroPeriod = heroEntry?.period;
  const extras = upcomingExtras(circle, o.current);
  // The headline total grows with every extra amount still to be collected.
  const extrasTotal = extras.reduce((s, x) => s + x.total, 0);
  const heroBonusTotal = heroPeriod?.bonus ? heroPeriod.bonus * Math.max(0, circle.members.length - 1) : 0;
  const headlineTotal = payoutPot(circle, heroPeriod) + extrasTotal - heroBonusTotal;

  return (
    <KeyboardScreen>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      {completion.done ? (
      <Pressable onPress={() => { tap(); setShowTurns(true); }} style={({ pressed }) => [styles.hero, pressed && { opacity: 0.9 }]}>
        <Celebration size={88} height={190} />
        <Text variant="title" color={colors.white} center>
          الجمعية انتهت 🎉
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.85)" center>
          كل الأقساط اتسددت وكل الأعضاء قبضوا أدوارهم.
        </Text>
        <Text variant="number" color={colors.gold}>
          {formatMoney(completion.totalCollected)}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.75)" center>
          اتجمعوا على {formatNumber(o.payoutsTotal)} دور • {formatNumber(circle.members.length)} عضو
        </Text>
        <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.sm }}>
          <ProgressBar value={1} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="caption" color={colors.white}>
              قبض {formatNumber(o.payoutsDone)} من {formatNumber(o.payoutsTotal)} ✓
            </Text>
            <Text variant="caption" weight="bold" color={colors.white}>
              تم السداد بالكامل ✓
            </Text>
          </Row>
        </View>
        <Row gap={4} style={styles.heroHint}>
          <Text variant="caption" weight="semibold" color={colors.white}>
            اضغط تشوف الأدوار والسداد
          </Text>
          <Ionicons name="chevron-back" size={14} color={colors.white} />
        </Row>
      </Pressable>
      ) : (
      <Pressable onPress={() => { tap(); setShowTurns(true); }} style={({ pressed }) => [styles.hero, pressed && { opacity: 0.9 }]}>
        {completion.allCollected ? (
          <Row gap={6} style={styles.heroHint}>
            <Ionicons name="checkmark-circle" size={16} color={colors.gold} />
            <Text variant="caption" weight="bold" color={colors.white}>
              {completion.payoutsLeft.length
                ? `كل الأقساط اتسددت — فاضل تسليم ${formatNumber(completion.payoutsLeft.length)} قبض`
                : `فاضل ${formatNumber(completion.awaitingReceipt.length)} يأكدوا إنهم استلموا فلوسهم`}
            </Text>
          </Row>
        ) : null}
        {heroEntry && heroEntry.due > 0 ? (() => {
          const hs = periodSummary(circle, payments, heroEntry.index);
          return (
            <View style={{ marginBottom: space.sm }}>
              <TurnRing total={hs.payers.length} paid={hs.confirmed.length} title={`دور ${heroEntry.recipient?.name ?? ''}`} />
            </View>
          );
        })() : null}
        <Text variant="caption" color="rgba(255,255,255,0.75)" center>
          {heroPeriod ? `القبض في دور ${heroEntry?.recipient?.name ?? ''} (${formatDate(heroEntry!.date)})` : 'القبض في كل دور'}
        </Text>
        <Text variant="number" color={colors.gold}>
          {formatMoney(extrasTotal ? headlineTotal : payoutPot(circle, heroPeriod))}
        </Text>
        {extrasTotal ? (
          <Text variant="caption" color="rgba(255,255,255,0.85)" center>
            القبض {formatMoney(payoutPot(circle, heroPeriod) - heroBonusTotal)} + مبالغ إضافية {formatMoney(extrasTotal)}
          </Text>
        ) : null}
        <Text variant="caption" color="rgba(255,255,255,0.85)" center>
          {formatNumber(circle.members.length)} عضو × {formatMoney(heroPeriod ? periodDue(circle, heroPeriod) : circle.installment)}{' '}
          {heroPeriod?.bonus ? `(القسط ${formatMoney(circle.installment)} + زيادة ${formatMoney(heroPeriod.bonus)})` : cadenceLabel(circle)}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.75)" center>
          صاحب الدور ما بيدفعش قسطه وبيستلم {formatMoney(payoutNet(circle, heroPeriod))}
        </Text>
        {extras.map((x) => (
          <Text key={x.entry.period.id} variant="caption" weight="bold" color="#FFD6A5">
            ➕ {x.kind === 'bonus' ? `زيادة على قسط دور ${x.entry.recipient?.name ?? ''}` : 'قسط إضافي'} ({formatDate(x.entry.date)}): {formatMoney(x.perMember)} على كل عضو
            {x.entry.period.note ? ` — ${x.entry.period.note}` : ''}
          </Text>
        ))}
        <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.sm }}>
          <ProgressBar value={o.ratio} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="caption" color={colors.white}>
              قبض {formatNumber(o.payoutsDone)} من {formatNumber(o.payoutsTotal)}
            </Text>
            <Text variant="caption" weight="bold" color={o.overdueAmount ? '#FFD6A5' : colors.white}>
              {o.overdueAmount ? `متأخرات ${formatMoney(o.overdueAmount)}` : 'مفيش متأخرات ✓'}
            </Text>
          </Row>
        </View>
        <Row gap={4} style={styles.heroHint}>
          <Text variant="caption" weight="semibold" color={colors.white}>
            اضغط تشوف الأدوار والسداد
          </Text>
          <Ionicons name="chevron-back" size={14} color={colors.white} />
        </Row>
      </Pressable>
      )}
      <TurnsSheet visible={showTurns} onClose={() => setShowTurns(false)} circle={circle} payments={payments} />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'collect', label: 'التحصيل', badge: o.pendingCount + openPayoutRequests },
          { value: 'schedule', label: 'الجدول' },
          { value: 'members', label: 'الأعضاء', badge: joinRequests.length },
          { value: 'messages', label: 'الرسائل' },
        ]}
      />

      {tab === 'collect' && <CollectTab circle={circle} payments={payments} payouts={payouts} uid={uid} />}
      {tab === 'schedule' && <ScheduleTab circle={circle} payments={payments} />}
      {tab === 'members' && <MembersTab circle={circle} payments={payments} requests={joinRequests} />}
      {tab === 'messages' && <MessagesTab circle={circle} payments={payments} uid={uid} />}
    </ScrollView>
    </KeyboardScreen>
  );
}

// ---------------------------------------------------------------------------
// Collection: approvals + one period at a time
// ---------------------------------------------------------------------------

function CollectTab({
  circle,
  payments,
  payouts,
  uid,
}: {
  circle: Circle;
  payments: Payment[];
  payouts: PayoutRequest[];
  uid: string;
}) {
  const entries = useMemo(() => timeline(circle), [circle]);
  const current = currentIndex(circle);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(current, entries.length - 1)));
  const { run } = useAction();
  const pending = pendingApprovals(circle, payments);
  const [review, setReview] = useState<{ payment: Payment; member: Member; entry: TimelineEntry } | null>(null);
  const [recording, setRecording] = useState<{ member: Member; entry: TimelineEntry; method: PaymentMethod } | null>(null);
  const [deferFor, setDeferFor] = useState<Member | null>(null);
  const [payoutFor, setPayoutFor] = useState<TimelineEntry | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<string | null>(null);
  const [earlyFor, setEarlyFor] = useState<Member | null>(null);
  const [earlyCount, setEarlyCount] = useState(1);
  // Early payments a member asked for together (two or more coming installments): approved in one go.
  const today = todayISO();
  const earlyGroups = Object.values(
    pending
      .filter((x) => x.entry.date > today)
      .reduce<Record<string, { member: Member; items: typeof pending }>>((acc, x) => {
        (acc[x.member.id] ??= { member: x.member, items: [] }).items.push(x);
        return acc;
      }, {}),
  ).filter((g) => g.items.length > 1);
  const grouped = new Set(earlyGroups.flatMap((g) => g.items.map((x) => x.payment.id)));
  const pendingSingles = pending.filter((x) => !grouped.has(x.payment.id));
  const approveEarly = async (g: { member: Member; items: typeof pending }) => {
    const total = g.items.reduce((t, x) => t + x.entry.due, 0);
    const transfer = g.items.some((x) => x.payment.hasReceipt);
    const ok = await confirm(
      `توافق على سداد ${g.member.name} المعجّل؟`,
      `${formatNumber(g.items.length)} قسط بإجمالي ${formatMoney(total)}. بعد الموافقة كلهم يتعلّموا مدفوعين.` +
        (transfer ? ` اتأكد الأول إن ${formatMoney(total)} وصلوا حسابك فعلًا.` : ''),
      transfer ? `أيوه، ${formatMoney(total)} وصلوا` : 'وافق واستلمت',
    );
    if (ok) {
      run(() => confirmMemberPeriods(circle.id, g.member.id, g.items.map((x) => x.entry.period.id), uid), {
        success: `اتوافق على سداد ${g.member.name} المعجّل ✓`,
      });
    }
  };
  const rejectEarly = async (g: { member: Member; items: typeof pending }) => {
    if (await confirm('رفض السداد المعجّل؟', `هتتشال كل طلبات ${g.member.name} (${formatNumber(g.items.length)} قسط).`, 'رفض', true)) {
      run(async () => {
        for (const x of g.items) await removePayment(circle.id, x.payment);
      });
    }
  };

  if (entries.length === 0) return <Text center>مفيش أدوار في الجدول.</Text>;
  const i = Math.min(index, entries.length - 1);
  const s = periodSummary(circle, payments, i);
  const entry = s.entry;

  /** Reminder only to the members who haven't paid this period (their private messages + push). */
  const remindUnpaid = async () => {
    const names = s.unpaid.map((m) => m.name).join('، ');
    if (!(await confirm('تذكير بالقسط', `التذكير هيوصل للي لسه ما دفعوش بس: ${names}`, 'ابعت التذكير'))) return;
    run(
      () =>
        postAnnouncement(
          circle.id,
          uid,
          `تذكير: قسط ${periodTitle(entry)}`,
          `لسه قسطك ما وصلش: ${formatMoney(entry.due)} — ميعاده ${formatDate(entry.date)}.\nادفع ودوس "دفعت" في التطبيق.`,
          { memberIds: s.unpaid.map((m) => m.id), uids: s.unpaid.map((m) => m.uid) },
        ),
      { success: `التذكير وصل لـ ${names} بس.` },
    );
  };


  /**
   * A transfer whose receipt the app couldn't verify is only confirmed after the
   * admin says the money is really in their account.
   */
  const approve = async (p: Payment) => {
    if (p.hasReceipt && p.receiptCheck !== 'auto') {
      const who = circle.members.find((m) => m.id === p.memberId)?.name ?? 'العضو';
      const due = timeline(circle).find((e) => e.period.id === p.periodId)?.due ?? circle.installment;
      const ok = await confirm(
        'اتأكد الأول إن الفلوس وصلت',
        `إيصال ${who} ما اتراجعش أوتوماتيك. افتح ${METHOD_LABEL[methodOf(p)]} بتاعك واتأكد إن ${formatMoney(due)} وصلوا حسابك فعلًا قبل ما تأكد.`,
        `أيوه، ${formatMoney(due)} وصلوا حسابي`,
      );
      if (!ok) return;
    }
    run(() => confirmPayment(circle.id, p.periodId, p.memberId, uid));
  };
  const reject = async (p: Payment, member: Member) => {
    if (await confirm('رفض الدفع؟', `هيتشال بلاغ ${member.name}${p.hasReceipt ? ' وصورة التحويل' : ''}، ويرجع القسط "لسه".`, 'رفض', true)) {
      run(() => removePayment(circle.id, p));
    }
  };

  /** Admin records a payment received directly: ask how it was paid. */
  const record = (m: Member) =>
    alert(
      `${m.name} دفع إزاي؟`,
      `${formatMoney(entry.due)} • ${periodTitle(entry)}`,
      [
        ...PAYMENT_METHODS.map((method) => ({
          text: METHOD_LABEL[method],
          icon: METHOD_ICON[method],
          color: METHOD_COLOR[method],
          hint: method === 'cash' ? 'استلمت الفلوس في إيدك' : 'لازم ترفق إيصال التحويل',
          onPress: () =>
            method === 'cash'
              ? run(() => confirmPayment(circle.id, entry.period.id, m.id, uid, 'cash'))
              : setRecording({ member: m, entry, method }),
        })),
        { text: 'أجّل قسطه لميعاد تاني', icon: 'hourglass-outline' as const, color: colors.goldText, onPress: () => setDeferFor(m) },
        { text: 'إلغاء', style: 'cancel' as const },
      ],
      { icon: 'wallet', tone: 'info' },
    );

  const toggle = (m: Member) => {
    tap();
    const p = findPayment(payments, entry.period.id, m.id);
    if (entry.index > current && !p) {
      // Not open yet — the one exception is an early payment the organizer accepts for this member.
      return alert('التحصيل لسه ما فتحش', `تحصيل ${periodTitle(entry)} بيفتح يوم ${formatDate(entry.date)}.`, [
        { text: `سجّل سداد مبكر لـ ${m.name}`, icon: 'flash-outline', color: colors.success, onPress: () => record(m) },
        ...(earlyPayable(circle, payments, m.id).length > 1
          ? [{ text: 'سداد معجّل لأكتر من قسط (كاش)', icon: 'albums-outline' as const, color: colors.primary, onPress: () => { setEarlyCount(earlyPayable(circle, payments, m.id).length); setEarlyFor(m); } }]
          : []),
        { text: 'أجّل قسطه لميعاد تاني', icon: 'hourglass-outline', color: colors.goldText, onPress: () => setDeferFor(m) },
        { text: 'تمام', style: 'cancel' },
      ], { icon: 'lock-closed', tone: 'info' });
    }
    // A member's early-payment request (paid before the date) is reviewed like any other.
    if (!p) return record(m);
    if (p.status === 'claimed') {
      if (p.hasReceipt) return setReview({ payment: p, member: m, entry });
      return alert(`${m.name} بيقول إنه دفع ${METHOD_LABEL[methodOf(p)]}`, `${formatMoney(entry.due)} • ${periodTitle(entry)}`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'رفض', style: 'destructive', icon: 'close-circle', onPress: () => reject(p, m) },
        { text: 'استلمت الفلوس', icon: 'checkmark-circle', color: colors.success, onPress: () => approve(p) },
      ]);
    }
    alert('إلغاء الدفع؟', `هتشيل دفع ${m.name} (${METHOD_LABEL[methodOf(p)]}) للفترة دي.`, [
      { text: 'لأ', style: 'cancel' },
      ...(p.hasReceipt
        ? [{ text: 'عرض صورة التحويل', icon: 'image' as const, onPress: () => setReview({ payment: p, member: m, entry }) }]
        : []),
      { text: 'شيل الدفع', style: 'destructive' as const, icon: 'trash' as const, onPress: () => run(() => removePayment(circle.id, p)) },
    ]);
  };

  const requestFor = (periodId: string) => payouts.find((r) => r.periodId === periodId);
  // New requests to review, and payouts the recipient says never arrived.
  const openRequests = payouts
    .filter((r) => r.status === 'requested' || r.status === 'disputed')
    .map((r) => ({ r, e: entries.find((x) => x.period.id === r.periodId) }))
    .filter((x): x is { r: PayoutRequest; e: TimelineEntry } => !!x.e && (x.r.status === 'disputed' || !x.e.period.paidOut));
  const thisRequest = requestFor(entry.period.id);

  return (
    <View style={{ gap: space.md }}>
      {openRequests.length > 0 && (
        <Card style={{ borderColor: colors.primary }}>
          <Row gap={space.sm}>
            <Ionicons name="wallet" size={20} color={colors.primary} />
            <Text variant="heading">طلبات القبض</Text>
          </Row>
          {openRequests.map(({ r, e }) => (
            <Pressable key={r.periodId} onPress={() => setPayoutFor(e)} style={({ pressed }) => [styles.pendingRow, pressed && { opacity: 0.7 }]}>
              <Row gap={space.sm}>
                <View style={{ flex: 1 }}>
                  <Row gap={space.xs}>
                    <Text weight="semibold">{e.recipient?.name ?? '—'}</Text>
                    {r.status === 'disputed' && <Badge label="بيقول ما وصلوش" tone="danger" />}
                  </Row>
                  <Text variant="caption">
                    {describePayout(r)} • {formatDate(e.date, false)}
                  </Text>
                  {r.status === 'disputed' && r.disputeNote ? (
                    <Text variant="caption" color={colors.danger}>“{r.disputeNote}”</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-back" size={18} color={colors.muted} />
              </Row>
            </Pressable>
          ))}
        </Card>
      )}

      {earlyGroups.map((g) => {
        const total = g.items.reduce((t, x) => t + x.entry.due, 0);
        const first = g.items[0].payment;
        return (
          <Card key={g.member.id} style={{ borderColor: colors.success }}>
            <Row gap={space.sm}>
              <View style={[styles.earlyBadge]}>
                <Ionicons name="flash" size={18} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading">طلب سداد معجّل</Text>
                <Text variant="caption">
                  {g.member.name} • {METHOD_LABEL[methodOf(first)]}
                </Text>
              </View>
              <Text weight="bold" color={colors.success}>
                {formatMoney(total)}
              </Text>
            </Row>
            <Text variant="caption">
              {formatNumber(g.items.length)} قسط: من {formatDate(g.items[0].entry.date, false)} لحد{' '}
              {formatDate(g.items[g.items.length - 1].entry.date, false)}
            </Text>
            {first.hasReceipt ? (
              <Text variant="caption" weight="bold" color={colors.primary} onPress={() => setReview({ payment: first, member: g.member, entry: g.items[0].entry })}>
                🧾 عرض صورة التحويل
              </Text>
            ) : null}
            <Row gap={space.sm}>
              <Button label="رفض" icon="close" variant="danger" style={{ flex: 1 }} onPress={() => rejectEarly(g)} />
              <Button label="وافق على الكل" icon="checkmark-done" style={{ flex: 2 }} onPress={() => approveEarly(g)} />
            </Row>
          </Card>
        );
      })}

      {pendingSingles.length > 0 && (
        <Card style={{ borderColor: colors.gold }}>
          <Row gap={space.sm}>
            <Ionicons name="notifications" size={20} color={colors.gold} />
            <Text variant="heading">مستني تأكيدك</Text>
          </Row>
          {pendingSingles.map(({ payment, entry: e, member }) => (
            <Row key={payment.id} style={styles.pendingRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={space.xs}>
                  <Text weight="semibold">{member.name}</Text>
                  <Badge label={METHOD_LABEL[methodOf(payment)]} tone={methodOf(payment) === 'cash' ? 'neutral' : 'gold'} />
                  {e.date > todayISO() ? <Badge label="سداد مبكر" tone="success" /> : null}
                </Row>
                <Text variant="caption">
                  {formatMoney(e.due)} • {periodTitle(e)} • {formatDate(e.date, false)}
                </Text>
                {payment.note ? <Text variant="caption">“{payment.note}”</Text> : null}
                {payment.hasReceipt ? (
                  payment.receiptCheck === 'auto' ? (
                    <Text variant="caption" weight="semibold" color={colors.success}>
                      ✓ الإيصال مطابق للقسط وحسابك
                    </Text>
                  ) : (
                    <Text variant="caption" weight="semibold" color={colors.danger}>
                      ⚠️ الإيصال ما اتراجعش — اتأكد إن الفلوس وصلت حسابك
                    </Text>
                  )
                ) : null}
                {payment.hasReceipt ? (
                  <Text
                    variant="caption"
                    weight="bold"
                    color={colors.primary}
                    onPress={() => setReview({ payment, member, entry: e })}
                  >
                    🧾 عرض صورة التحويل
                  </Text>
                ) : null}
              </View>
              <IconButton icon="close" label="رفض" color={colors.danger} bg={colors.dangerSoft} onPress={() => reject(payment, member)} />
              <IconButton icon="checkmark" label="تأكيد" color={colors.white} bg={colors.success} onPress={() => approve(payment)} />
            </Row>
          ))}
        </Card>
      )}

      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-forward" label="اللي فات" disabled={i === 0} onPress={() => setIndex(i - 1)} />
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text variant="heading">{periodTitle(entry)}</Text>
          <Text variant="caption">
            {formatDate(entry.date)}
            {i === current ? ' • الحالي' : ''}
          </Text>
        </View>
        <IconButton icon="chevron-back" label="اللي جاي" disabled={i === entries.length - 1} onPress={() => setIndex(i + 1)} />
      </Row>

      {entry.period.kind === 'skip' ? (
        <Card>
          <Row gap={space.sm}>
            <Ionicons name="pause-circle" size={24} color={colors.muted} />
            <Text style={{ flex: 1 }}>فترة مؤجلة — مفيش أقساط ولا قبض.{entry.period.note ? ` (${entry.period.note})` : ''}</Text>
          </Row>
        </Card>
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption">
                اتجمع {formatMoney(s.collected)} من {formatMoney(s.pot)}
              </Text>
              <Text variant="caption" weight="bold">
                {formatNumber(s.confirmed.length)}/{formatNumber(s.payers.length)}
              </Text>
            </Row>
            <ProgressBar value={s.pot ? s.collected / s.pot : 0} color={s.isComplete ? colors.success : colors.gold} />
            {entry.period.kind === 'payout' && (
              <>
                {thisRequest && !entry.period.paidOut ? (
                  <Row gap={space.xs}>
                    <Text variant="caption" style={{ flex: 1 }}>
                      طلب {entry.recipient?.name}: {describePayout(thisRequest)}
                    </Text>
                    <Badge label={PAYOUT_STATUS_LABEL[thisRequest.status]} tone={PAYOUT_TONE[thisRequest.status]} />
                  </Row>
                ) : null}
                {!s.isComplete && !entry.period.paidOut ? (
                  <Text variant="caption" color={colors.danger}>
                    لسه في أقساط ما اتأكدتش للفترة دي.
                  </Text>
                ) : null}
                {entry.index > current && !entry.period.paidOut && !s.isComplete ? (
                  // The payout opens on its date — or as soon as every installment is in (early payments).
                  <Row gap={space.xs}>
                    <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
                    <Text variant="caption">
                      قبض {entry.recipient?.name ?? ''} بيفتح يوم {formatDate(entry.date)}
                    </Text>
                  </Row>
                ) : (
                <Button
                  label={
                    entry.recipient && entry.recipient.id === circle.ownerMemberId
                      ? entry.period.paidOut
                        ? 'قبضت دورك ✓'
                        : 'سجّل إنك قبضت دورك'
                      : entry.period.paidOut
                      ? thisRequest?.status === 'received'
                        ? `${entry.recipient?.name ?? ''} قبض وأكّد الاستلام ✓`
                        : thisRequest?.status === 'disputed'
                          ? `${entry.recipient?.name ?? ''} بيقول ما وصلوش — راجع`
                          : `${entry.recipient?.name ?? ''} قبض • مستني تأكيده`
                      : thisRequest?.status === 'requested'
                        ? `راجع طلب قبض ${entry.recipient?.name ?? ''}`
                        : `تسليم القبض لـ ${entry.recipient?.name ?? ''}`
                  }
                  icon={entry.period.paidOut ? 'checkmark-done' : 'cash-outline'}
                  variant={entry.period.paidOut ? 'secondary' : 'primary'}
                  onPress={() => setPayoutFor(entry)}
                />
                )}
              </>
            )}
          </Card>

          {entry.index > current && !s.isComplete && (
            <Row gap={space.xs} style={{ paddingHorizontal: space.sm }}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
              <Text variant="caption" style={{ flex: 1 }}>
                التحصيل بيفتح يوم {formatDate(entry.date)} — غيّر تاريخ البداية من الإعدادات لو عايز تبدأ بدري.
              </Text>
            </Row>
          )}
          <Card style={{ gap: 0, paddingVertical: space.sm }}>
            {circle.members.map((m, k) => {
              if (s.covered.includes(m)) {
                return (
                  <View key={m.id} style={[styles.row, k > 0 && styles.divider]}>
                    <View style={[styles.check, styles.checkCovered]}>
                      <Ionicons name="gift" size={18} color={colors.white} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text weight="semibold" numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text variant="caption" color={colors.success}>
                        صاحب الدور — قسطه محسوب مدفوع
                      </Text>
                    </View>
                  </View>
                );
              }
              const p = findPayment(payments, entry.period.id, m.id);
              const state = p?.status;
              return (
                <View key={m.id} style={[styles.row, k > 0 && styles.divider]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: state === 'confirmed' }}
                    accessibilityLabel={m.name}
                    onPress={() => toggle(m)}
                    style={[styles.check, state === 'confirmed' && styles.checkOn, state === 'claimed' && styles.checkClaimed]}
                  >
                    {state === 'confirmed' && <Ionicons name="checkmark" size={20} color={colors.white} />}
                    {state === 'claimed' && <Ionicons name="time" size={18} color={colors.goldText} />}
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onLongPress={() => !state && setDeferFor(m)} delayLongPress={350}>
                    <Text weight="semibold" numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text
                      variant="caption"
                      color={state === 'confirmed' ? colors.success : !state && deferralOf(entry.period, m.id) ? colors.goldText : colors.muted}
                    >
                      {state === 'confirmed'
                        ? `دفع • ${METHOD_LABEL[methodOf(p)]}`
                        : state === 'claimed'
                          ? `بيقول إنه دفع ${METHOD_LABEL[methodOf(p)]} — دوس للمراجعة`
                          : deferralOf(entry.period, m.id)
                            ? `⏳ مؤجَّل لحد ${formatDate(deferralOf(entry.period, m.id)!)}`
                            : 'لسه'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>

          {s.unpaid.length > 0 && i <= current ? (
            <Button label={`ذكّر اللي ما دفعوش (${formatNumber(s.unpaid.length)})`} icon="notifications-outline" onPress={remindUnpaid} />
          ) : null}
          <Button
            label="الكل دفع"
            icon="checkmark-done"
            variant="secondary"
            disabled={s.confirmed.length === s.payers.length || entry.index > current}
            onPress={async () => {
              const unverified = s.payers.filter((m) => {
                const p = findPayment(payments, entry.period.id, m.id);
                return p?.status === 'claimed' && p.hasReceipt && p.receiptCheck !== 'auto';
              });
              const ids = s.payers.filter((m) => !s.confirmed.includes(m) && !unverified.includes(m)).map((m) => m.id);
              if (ids.length === 0) {
                return alert('أكّدهم واحد واحد', `الإيصالات اللي فاضلة ما اتراجعتش: ${unverified.map((m) => m.name).join('، ')}. اتأكد إن الفلوس وصلت حسابك وأكّد كل واحد لوحده.`);
              }
              const note = unverified.length
                ? `\n\nمش هيتأكد معاهم: ${unverified.map((m) => m.name).join('، ')} — إيصالاتهم ما اتراجعتش، أكّدهم لوحدهم بعد ما تتأكد إن الفلوس وصلت.`
                : '';
              if (await confirm('تأكيد الكل؟', `هتسجل دفع ${formatNumber(ids.length)} عضو كاش. اللي حوّل إنستاباي أو فودافون كاش سجّله لوحده بالإيصال.${note}`, 'سجّل')) {
                run(() => confirmMany(circle.id, entry.period.id, ids, uid));
              }
            }}
          />
        </>
      )}
      <DeferSheet
        member={deferFor}
        entry={entry}
        onClose={() => setDeferFor(null)}
        onPick={(date) => {
          const m = deferFor;
          setDeferFor(null);
          if (!m) return;
          run(() => mutatePeriods(circle.id, (ps) => setDeferral(ps, entry.period.id, m.id, date)), {
            success: date ? `${m.name} هيدفع ${periodTitle(entry)} لحد ${formatDate(date)}.` : `اتلغى تأجيل ${m.name}.`,
          });
        }}
      />
      <Sheet visible={!!earlyFor} title={`سداد معجّل — ${earlyFor?.name ?? ''}`} onClose={() => setEarlyFor(null)}>
        {earlyFor ? (() => {
          const list = earlyPayable(circle, payments, earlyFor.id);
          const n = Math.max(1, Math.min(earlyCount, list.length));
          const total = list.slice(0, n).reduce((t, x) => t + x.due, 0);
          return (
            <>
              <Text variant="caption">استلمت منه كام قسط كاش؟ بيتعلّموا مدفوعين بالترتيب من أقرب قسط جاي.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
                {list.map((e, k) => (
                  <Chip
                    key={e.period.id}
                    label={k + 1 === list.length && k > 0 ? 'كل اللي عليه' : `${formatNumber(k + 1)} قسط`}
                    sub={formatMoney(list.slice(0, k + 1).reduce((t, x) => t + x.due, 0))}
                    active={n === k + 1}
                    onPress={() => setEarlyCount(k + 1)}
                  />
                ))}
              </ScrollView>
              {list.length ? (
                <Text variant="caption" weight="bold" color={colors.primary}>
                  {formatMoney(total)} • {formatNumber(n)} قسط لحد {formatDate(list[n - 1].date)}
                </Text>
              ) : null}
              <Button
                label={`استلمت ${formatMoney(total)} كاش`}
                icon="checkmark-done"
                disabled={!list.length}
                onPress={() => {
                  const ids = list.slice(0, n).map((e) => e.period.id);
                  const who = earlyFor;
                  setEarlyFor(null);
                  run(() => confirmMemberPeriods(circle.id, who.id, ids, uid, 'cash'), { success: `${who.name} سدّد ${formatNumber(n)} قسط معجّل ✓` });
                }}
              />
              <Text variant="caption">لو حوّل InstaPay أو فودافون كاش، خليه يبعت طلب السداد المعجّل من التطبيق بصورة التحويل.</Text>
            </>
          );
        })() : null}
      </Sheet>
      <AdminRecordTransferSheet
        circle={circle}
        entry={recording?.entry ?? null}
        member={recording?.member ?? null}
        method={recording?.method ?? 'instapay'}
        uid={uid}
        onClose={() => setRecording(null)}
      />
      <AdminPayoutSheet
        circle={circle}
        entry={payoutFor}
        request={payoutFor ? requestFor(payoutFor.period.id) : undefined}
        uid={uid}
        onClose={() => setPayoutFor(null)}
        onShowReceipt={(pid) => {
          setPayoutFor(null);
          setPayoutReceipt(pid);
        }}
      />
      <ReceiptViewer
        source={payoutReceipt ? { key: `payout-${payoutReceipt}`, load: () => loadPayoutReceipt(circle.id, payoutReceipt) } : null}
        title="إيصال تحويل القبض"
        onClose={() => setPayoutReceipt(null)}
      />
      <ReceiptViewer
        source={review ? { key: review.payment.id, load: () => loadReceipt(circle.id, review.payment.id) } : null}
        title={review ? `${review.member.name} • ${METHOD_LABEL[methodOf(review.payment)]}` : ''}
        subtitle={review ? `${formatMoney(review.entry.due)} • ${formatDate(review.entry.date)}` : undefined}
        onClose={() => setReview(null)}
        footer={
          review?.payment.status === 'claimed' ? (
            <>
              <Button
                label="رفض"
                icon="close"
                variant="danger"
                style={{ flex: 1 }}
                onPress={() => {
                  const r = review;
                  setReview(null);
                  reject(r.payment, r.member);
                }}
              />
              <Button
                label="استلمت ✓"
                icon="checkmark-done"
                style={{ flex: 2, backgroundColor: colors.success, borderColor: colors.success }}
                onPress={() => {
                  approve(review.payment);
                  setReview(null);
                }}
              />
            </>
          ) : null
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Schedule: postpone, extra installment, extra turn, reorder, draw
// ---------------------------------------------------------------------------

function ScheduleTab({ circle, payments }: { circle: Circle; payments: Payment[] }) {
  const entries = timeline(circle);
  const current = currentIndex(circle);
  const nextIndex = Math.min(current + 1, entries.length); // first period that hasn't started
  const { run } = useAction();
  const [extraOpen, setExtraOpen] = useState(false);
  const [turnOpen, setTurnOpen] = useState(false);
  const [turnFor, setTurnFor] = useState<Member | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const { fixed: ownerTurn } = drawablePayouts(circle);
  // Any turn that hasn't come yet can be (re)drawn — before or after the circle starts.
  const drawable = openPayouts(circle, current);
  const drawStarted = current >= 0 || circle.periods.some((p) => p.paidOut);
  const nameOf = (id?: string) => circle.members.find((m) => m.id === id)?.name ?? '—';
  const wheelEntries = drawable.map((p) => ({ key: p.id, value: p.recipientId ?? '', name: nameOf(p.recipientId) }));
  const [amount, setAmount] = useState('');
  const [extraMode, setExtraMode] = useState<'bonus' | 'separate'>('bonus');
  // Upcoming turns the extra can be added to (the recipient collects it).
  const upcomingTurns = entries.filter((e) => e.period.kind === 'payout' && e.index > current && !e.period.paidOut);
  const [bonusTarget, setBonusTarget] = useState<string>('all');
  const [note, setNote] = useState('');

  const hasPayments = (periodId: string) => payments.some((p) => p.periodId === periodId);
  const unit = FREQUENCY_LABEL[circle.frequency].unit;

  // Deferring chosen members' installment (only theirs — everyone else stays as is).
  const deferrable = entries.filter((e) => e.due > 0 && e.index >= Math.max(0, current));
  const [deferOpen, setDeferOpen] = useState(false);
  const [deferPeriod, setDeferPeriod] = useState<string | null>(null);
  const [deferWho, setDeferWho] = useState<string[]>([]);
  const [deferDays, setDeferDays] = useState<number>(30);
  const [deferCustom, setDeferCustom] = useState('');
  const deferEntry = deferrable.find((e) => e.period.id === deferPeriod) ?? deferrable[0];
  // Members who owe that installment and haven't paid it yet.
  const deferCandidates = deferEntry
    ? circle.members.filter(
        (m) => !(deferEntry.period.kind === 'payout' && deferEntry.period.recipientId === m.id) && !payments.some((p) => p.periodId === deferEntry.period.id && p.memberId === m.id),
      )
    : [];
  const customN = Math.round(Number(deferCustom.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))));
  const deferBy = deferCustom.trim() ? customN : deferDays;
  const deferFrom = deferEntry ? (deferEntry.date > todayISO() ? deferEntry.date : todayISO()) : todayISO();
  const deferUntil = deferBy >= 1 && deferBy <= 365 ? addDays(deferFrom, deferBy) : null;
  const openDefer = () => {
    setDeferPeriod(deferrable[0]?.period.id ?? null);
    setDeferWho([]);
    setDeferDays(30);
    setDeferCustom('');
    setDeferOpen(true);
  };
  const applyDefer = () => {
    if (!deferEntry || !deferUntil || !deferWho.length) return;
    const names = circle.members.filter((m) => deferWho.includes(m.id)).map((m) => m.name).join('، ');
    const ids = [...deferWho];
    const pid = deferEntry.period.id;
    setDeferOpen(false);
    run(() => mutatePeriods(circle.id, (ps) => ids.reduce((acc, id) => setDeferral(acc, pid, id, deferUntil), ps)), {
      success: `${names} هيدفعوا ${periodTitle(deferEntry)} لحد ${formatDate(deferUntil)}.`,
    });
  };

  const doPostpone = async (at: number) => {
    const date = entries[at]?.date;
    const ok = await confirm(
      `تأجيل ${unit}`,
      date
        ? `الفترة اللي ميعادها ${formatDate(date)} وكل اللي بعدها هيتأجلوا ${unit}.`
        : `هيتضاف ${unit} فاضي في آخر الجدول.`,
      'أجّل',
    );
    if (ok) run(() => mutatePeriods(circle.id, (ps) => postpone(ps, at)), { success: 'تم التأجيل وكل المواعيد اتحدّثت.' });
  };

  // Speed-up: from the first turn that hasn't come yet.
  const speedFrom = Math.max(0, current + 1);
  const sped = isSpedUp(circle.periods);
  const plannedEnd = endDate(circle);
  // Pay more per date → more turns per date → finished sooner.
  const [perDateText, setPerDateText] = useState('');
  const perDate = parseAmount(perDateText);
  const amountPlan = perDate > circle.installment ? speedUpByAmount(circle, speedFrom, perDate) : null;
  const amountEnd = amountPlan ? endDate({ ...circle, periods: amountPlan.periods }) : null;
  const datesNow = speedUpByAmount(circle, speedFrom, circle.installment).perDateDues.length;
  // One extra payment on a date the organizer picks → the next turns move up.
  const pullChoices = extraDateChoices(circle);
  const [pullDate, setPullDate] = useState<string | null>(null);
  const [pullCount, setPullCount] = useState(1);
  const pulled = pullDate ? pullTurnsTo(circle, pullDate, pullCount) : null;
  const pullEnd = pulled ? endDate({ ...circle, periods: pulled }) : null;
  const setDates = extraDates(circle);
  const applyPull = async () => {
    if (!pullDate || !pulled) return;
    setSpeedOpen(false);
    const ok = await confirm(
      `دفعة زيادة يوم ${formatDate(pullDate)}`,
      `كل عضو يدفع ${formatMoney(circle.installment * pullCount)} يوم ${formatDate(pullDate)}، و${pullCount > 1 ? `${formatNumber(pullCount)} أدوار بيتقبضوا` : 'الدور الجاي بيتقبض'} في نفس اليوم. الأدوار اللي بعده تتقدّم، وآخر دور يبقى ${pullEnd ? formatDate(pullEnd) : '—'} بدل ${plannedEnd ? formatDate(plannedEnd) : '—'}.`,
      'تمام',
    );
    if (ok) {
      run(() => mutatePeriods(circle.id, (ps) => pullTurnsTo({ ...circle, periods: ps }, pullDate, pullCount) ?? ps), {
        success: 'الدفعة اتسجّلت والمواعيد اتحدّثت عند كل الأعضاء.',
      });
      setPullDate(null);
      setPullCount(1);
    }
  };
  const cancelPull = async (date: string) => {
    if (await confirm('إلغاء الدفعة الزيادة؟', `الأدوار اللي اتقدّمت ليوم ${formatDate(date)} ترجع لمواعيدها.`, 'إلغاء الدفعة', true)) {
      run(() => mutatePeriods(circle.id, (ps) => clearExtraDate(ps, date)), { success: 'اتلغت والمواعيد رجعت.' });
    }
  };
  const applyAmount = async () => {
    if (!amountPlan) return;
    setSpeedOpen(false);
    const dues = [...new Set(amountPlan.perDateDues)].map((d) => formatMoney(d)).join(' / ');
    const ok = await confirm(
      `الأعضاء يدفعوا ${formatMoney(perDate)} كل ميعاد`,
      `الأدوار اللي جاية تخلص في ${formatNumber(amountPlan.perDateDues.length)} ميعاد بدل ${formatNumber(datesNow)}، وآخر دور ${amountEnd ? formatDate(amountEnd) : '—'} بدل ${plannedEnd ? formatDate(plannedEnd) : '—'}. ` +
        `اللي بيتدفع في كل ميعاد: ${dues}${amountPlan.perDateDues.some((d) => d !== perDate) ? ' (في المتوسط ' + formatMoney(perDate) + ')' : ''}. وكل صاحب دور بياخد قبضه كامل. بلّغ الأعضاء من تبويب الرسائل.`,
      'تمام',
    );
    if (ok) {
      run(() => mutatePeriods(circle.id, (ps) => speedUpByAmount({ ...circle, periods: ps }, speedFrom, perDate).periods), {
        success: 'المواعيد الجديدة اتسجّلت وظهرت عند كل الأعضاء.',
      });
      setPerDateText('');
    }
  };
  const endWith = (mode: SpeedUp | 'normal') => endDate({ ...circle, periods: speedUp(circle.periods, speedFrom, mode) });
  const speedOptions: { mode: SpeedUp; title: string; body: string }[] = [
    {
      mode: 'double',
      title: 'دورين في كل ميعاد',
      body: 'كل عضو يدفع قسطين في الميعاد، واتنين يقبضوا مع بعض — الجمعية تخلص في نص المدة الباقية.',
    },
    ...(circle.frequency === 'quarterly' || circle.frequency === 'every4months'
      ? [{ mode: 'month' as const, title: 'كل شهر', body: 'الأقساط الجاية تبقى كل شهر بدل كل كام شهر.' }]
      : []),
    ...(circle.frequency !== 'weekly'
      ? [
          { mode: '2weeks' as const, title: 'كل أسبوعين', body: 'الأقساط الجاية تبقى كل أسبوعين.' },
          { mode: 'week' as const, title: 'كل أسبوع', body: 'الأقساط الجاية تبقى كل أسبوع.' },
        ]
      : []),
  ];
  const applySpeed = async (mode: SpeedUp | 'normal', label: string) => {
    setSpeedOpen(false);
    const end = endWith(mode);
    const ok = await confirm(
      mode === 'normal' ? 'ترجع المواعيد العادية؟' : `تسريع الجمعية: ${label}`,
      `ده بيغيّر مواعيد الأدوار اللي لسه ما جاش ميعادها بس. آخر دور هيبقى ${end ? formatDate(end) : '—'} بدل ${plannedEnd ? formatDate(plannedEnd) : '—'}. بلّغ الأعضاء من تبويب الرسائل.`,
      'تمام',
    );
    if (ok) run(() => mutatePeriods(circle.id, (ps) => speedUp(ps, speedFrom, mode)), { success: 'المواعيد الجديدة اتسجّلت وظهرت عند كل الأعضاء.' });
  };

  const scheduleExtras = upcomingExtras(circle, current);
  const cancelExtra = async (x: (typeof scheduleExtras)[number]) => {
    if (hasPayments(x.entry.period.id)) {
      return alert('مينفعش يتلغي', 'في أعضاء دفعوا الفترة دي بالفعل. شيل مدفوعاتهم الأول من تبويب التحصيل لو عايز تلغيه.', undefined, { icon: 'lock-closed', tone: 'info' });
    }
    const ok = await confirm(
      'إلغاء المبلغ الإضافي؟',
      x.kind === 'bonus'
        ? `قسط دور ${x.entry.recipient?.name ?? ''} يرجع ${formatMoney(circle.installment)} زي الأول، والإجمالي يقل ${formatMoney(x.total)}.`
        : `القسط الإضافي بتاع ${formatDate(x.entry.date)} هيتشال، والأدوار اللي بعده ترجع لمواعيدها.`,
      'إلغاء المبلغ',
      true,
    );
    if (ok)
      run(() => mutatePeriods(circle.id, (ps) => (x.kind === 'bonus' ? clearBonus(ps, x.entry.period.id) : removePeriod(ps, x.entry.period.id))), {
        success: 'اتلغى، وظهر التعديل عند كل الأعضاء.',
      });
  };

  const actions = (e: TimelineEntry) => {
    const started = e.index <= current;
    const buttons: DialogButton[] = [];
    if (!started) buttons.push({ text: `أجّل الفترة دي ${unit}`, icon: 'time', color: colors.goldText, onPress: () => doPostpone(e.index) });
    // A second turn can't jump ahead of someone's first one (and the reverse).
    const swapOk = (a: number, b: number) => {
      const ra = roundOf(circle.periods, a);
      const rb = roundOf(circle.periods, b);
      return !ra || !rb || ra === rb;
    };
    const blocked = () => alert('مينفعش', 'الدور التاني لأي عضو بييجي بعد ما كل الأعضاء ياخدوا دورهم الأول.', undefined, { icon: 'lock-closed', tone: 'info' });
    if (e.index > 0 && !started && e.index - 1 > current)
      buttons.push({ text: 'طلّعها لفوق', icon: 'arrow-up', onPress: () => (swapOk(e.index, e.index - 1) ? run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index - 1))) : blocked()) });
    if (e.index < entries.length - 1 && !started)
      buttons.push({ text: 'نزّلها لتحت', icon: 'arrow-down', onPress: () => (swapOk(e.index, e.index + 1) ? run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index + 1))) : blocked()) });
    if (e.period.kind !== 'payout' || !hasPayments(e.period.id)) {
      if (e.period.kind !== 'payout' || circle.periods.filter((p) => p.recipientId === e.period.recipientId).length > 1) {
        buttons.push({
          text: 'احذف الفترة',
          style: 'destructive',
          icon: 'trash',
          onPress: () => run(() => mutatePeriods(circle.id, (ps) => removePeriod(ps, e.period.id))),
        });
      }
    }
    if (buttons.length === 0) return alert('الفترة دي بدأت', 'مينفعش تتعدّل بعد ما ميعادها جه.');
    alert(periodTitle(e), formatDate(e.date), [...buttons, { text: 'إلغاء', style: 'cancel' }], { icon: 'calendar' });
  };

  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Text variant="heading">تحكّم في الجدول</Text>
        <Row gap={space.sm}>
          <ActionTile label="تأجيل قسط" icon="pause-circle-outline" tone="orange" disabled={!deferrable.length} onPress={openDefer} />
          <ActionTile label="مبلغ إضافي" icon="add-circle-outline" tone="success" onPress={() => setExtraOpen(true)} />
          <ActionTile label="دور إضافي" icon="person-add-outline" onPress={() => setTurnOpen(true)} />
        </Row>
        <Row gap={space.sm}>
          <ActionTile label="عجلة القرعة" icon="sync-circle-outline" tone="gold" disabled={drawable.length < 2} onPress={() => setWheelOpen(true)} />
          <ActionTile
            label={sped ? 'متسرّعة — غيّر' : 'تسريع الجمعية'}
            icon="flash-outline"
            tone="gold"
            badge={sped}
            disabled={circle.periods.length - speedFrom < 2}
            onPress={() => setSpeedOpen(true)}
          />
        </Row>
        <Text variant="caption">
          دوس على أي فترة لتأجيلها، أو تحريكها، أو حذفها.
          {drawStarted ? ' القرعة بتعيد ترتيب الأدوار اللي لسه ما جاش ميعادها بس — اللي قبض أو دوره جه بيفضل مكانه.' : ''}
        </Text>
      </Card>

      {scheduleExtras.length ? (
        <Card>
          <Text variant="heading">المبالغ الإضافية</Text>
          {scheduleExtras.map((x) => (
            <Row key={x.entry.period.id} gap={space.sm}>
              <Ionicons name="add-circle" size={22} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Text weight="semibold">
                  {x.kind === 'bonus' ? `زيادة على قسط دور ${x.entry.recipient?.name ?? ''}` : 'قسط إضافي'} • {formatMoney(x.perMember)} على كل عضو
                </Text>
                <Text variant="caption">
                  {formatDate(x.entry.date)} • الإجمالي {formatMoney(x.total)}
                  {x.entry.period.note ? ` • ${x.entry.period.note}` : ''}
                </Text>
              </View>
              <IconButton icon="close" label="إلغاء" color={colors.danger} bg={colors.dangerSoft} onPress={() => cancelExtra(x)} />
            </Row>
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        {entries.map((e, k) => {
          const isCurrent = e.index === current;
          const icon = e.period.kind === 'skip' ? 'pause' : e.period.kind === 'extra' ? 'add' : null;
          return (
            <Pressable
              key={e.period.id}
              onPress={() => actions(e)}
              style={({ pressed }) => [styles.row, k > 0 && styles.divider, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.num, isCurrent && { backgroundColor: colors.gold }, e.period.kind === 'skip' && { backgroundColor: colors.border }]}>
                {icon ? (
                  <Ionicons name={icon} size={18} color={colors.primary} />
                ) : (
                  <Text weight="bold" color={isCurrent ? colors.white : colors.primary}>
                    {formatNumber(e.index + 1)}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={1} color={e.period.kind === 'skip' ? colors.muted : colors.text}>
                  {e.period.kind === 'payout' ? e.recipient?.name ?? '—' : periodTitle(e)}
                </Text>
                <Text variant="caption">
                  {formatDate(e.date)}
                  {e.period.kind === 'extra' ? ` • ${formatMoney(e.due)} للفرد` : ''}
                  {e.period.kind === 'payout' && e.period.bonus ? ` • القسط ${formatMoney(e.due)} (+${formatMoney(e.period.bonus)})` : ''}
                  {e.period.note ? ` • ${e.period.note}` : ''}
                </Text>
              </View>
              {e.period.paidOut ? (
                <Badge label="استلم" tone="success" />
              ) : isCurrent ? (
                <Badge label="الحالي" tone="gold" />
              ) : e.index < current && e.period.kind === 'payout' ? (
                <Badge label="ما استلمش" tone="danger" />
              ) : (
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
              )}
            </Pressable>
          );
        })}
      </Card>

      <Sheet visible={extraOpen} title="مبلغ إضافي على الأعضاء" onClose={() => setExtraOpen(false)}>
        <Segmented
          value={extraMode}
          onChange={setExtraMode}
          options={[
            { value: 'bonus', label: 'يتضاف على القسط' },
            { value: 'separate', label: 'قسط لوحده' },
          ]}
        />
        <Text variant="caption">
          {extraMode === 'bonus'
            ? 'كل عضو يدفع المبلغ ده زيادة على قسطه في الدور اللي تختاره، وصاحب الدور بيقبضه معاه. المواعيد ما بتتغيّرش.'
            : 'كل الأعضاء يدفعوا المبلغ ده في فترة لوحدها من غير ما حد يقبض (مثلًا مصاريف). الأدوار اللي بعدها تتأخر فترة.'}
        </Text>
        <Field label="المبلغ الزيادة على كل عضو" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="مثلًا 200" />
        {extraMode === 'bonus' ? (
          upcomingTurns.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
              <Chip label="كل الأدوار الجاية" active={bonusTarget === 'all'} onPress={() => setBonusTarget('all')} />
              {upcomingTurns.map((e) => (
                <Chip
                  key={e.period.id}
                  label={e.recipient?.name ?? ''}
                  sub={formatDate(e.date)}
                  active={bonusTarget === e.period.id}
                  onPress={() => setBonusTarget(e.period.id)}
                />
              ))}
            </ScrollView>
          ) : (
            <Text variant="caption" color={colors.danger}>مفيش أدوار جاية لسه ما جاش ميعادها.</Text>
          )
        ) : null}
        {extraMode === 'bonus' && parseAmount(amount) > 0 && upcomingTurns.length ? (
          <Text variant="caption" weight="bold" color={colors.success}>
            القسط يبقى {formatMoney(circle.installment + parseAmount(amount))} وصاحب الدور يقبض{' '}
            {formatMoney((circle.installment + parseAmount(amount)) * Math.max(0, circle.members.length - 1))}
          </Text>
        ) : null}
        <Field label="السبب (اختياري)" value={note} onChangeText={setNote} placeholder="مثلًا: علشان نخلّص بدري" maxLength={120} />
        <Button
          label="ضيف المبلغ"
          icon="checkmark"
          disabled={!(parseAmount(amount) > 0) || (extraMode === 'bonus' && !upcomingTurns.length)}
          onPress={() => {
            setExtraOpen(false);
            const value = parseAmount(amount);
            if (extraMode === 'bonus') {
              const ids = bonusTarget === 'all' ? upcomingTurns.map((e) => e.period.id) : [bonusTarget];
              run(() => mutatePeriods(circle.id, (ps) => addBonus(ps, ids, value, note.trim())), {
                success: 'اتضاف على القسط، وظهر عند كل الأعضاء.',
              });
            } else {
              run(() => mutatePeriods(circle.id, (ps) => addExtraInstallment(ps, nextIndex, value, note.trim())));
            }
            setNote('');
            setAmount('');
          }}
        />
      </Sheet>

      <Sheet visible={deferOpen} title="تأجيل قسط" onClose={() => setDeferOpen(false)}>
        <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
          <Text weight="semibold">أنهي قسط؟</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
            {deferrable.slice(0, 24).map((e) => (
              <Chip
                key={e.period.id}
                label={formatDate(e.date, false)}
                sub={e.period.kind === 'payout' ? `دور ${nameOf(e.period.recipientId)}` : 'قسط إضافي'}
                active={deferEntry?.period.id === e.period.id}
                onPress={() => {
                  setDeferPeriod(e.period.id);
                  setDeferWho([]);
                }}
              />
            ))}
          </ScrollView>

          <Row style={{ justifyContent: 'space-between' }}>
            <Text weight="semibold">مين يتأجل؟</Text>
            {deferCandidates.length > 1 ? (
              <Text
                variant="caption"
                weight="bold"
                color={colors.primary}
                onPress={() => setDeferWho(deferWho.length === deferCandidates.length ? [] : deferCandidates.map((m) => m.id))}
              >
                {deferWho.length === deferCandidates.length ? 'شيل الكل' : 'اختار الكل'}
              </Text>
            ) : null}
          </Row>
          {deferCandidates.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {deferCandidates.map((m) => {
                const on = deferWho.includes(m.id);
                const already = deferEntry ? deferralOf(deferEntry.period, m.id) : undefined;
                return (
                  <Chip
                    key={m.id}
                    label={m.name}
                    sub={already ? `مؤجَّل لحد ${formatDate(already, false)}` : undefined}
                    active={on}
                    onPress={() => setDeferWho(on ? deferWho.filter((x) => x !== m.id) : [...deferWho, m.id])}
                  />
                );
              })}
            </View>
          ) : (
            <Text variant="caption">كل الأعضاء دفعوا القسط ده.</Text>
          )}

          <Text weight="semibold">يتأجل قد إيه؟</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[
              { label: 'أسبوع', d: 7 },
              { label: 'أسبوعين', d: 14 },
              { label: 'شهر', d: 30 },
              { label: 'شهرين', d: 60 },
              { label: '٣ شهور', d: 90 },
            ].map((o) => (
              <Chip
                key={o.d}
                label={o.label}
                active={!deferCustom.trim() && deferDays === o.d}
                onPress={() => {
                  setDeferCustom('');
                  setDeferDays(o.d);
                }}
              />
            ))}
          </View>
          <Field label="أو عدد أيام معيّن" value={deferCustom} onChangeText={setDeferCustom} keyboardType="number-pad" maxLength={3} placeholder="مثلًا 45" />

          {deferUntil && deferWho.length ? (
            <View style={styles.deferSummary}>
              <Ionicons name="hourglass-outline" size={18} color={colors.goldText} />
              <Text weight="semibold" color={colors.goldText} style={{ flex: 1 }}>
                {formatNumber(deferWho.length)} عضو هيدفعوا لحد {formatDate(deferUntil)}، والباقيين مواعيدهم زي ما هي.
              </Text>
            </View>
          ) : null}
          <Button label="أجّل" icon="checkmark-circle-outline" disabled={!deferUntil || !deferWho.length} onPress={applyDefer} />
          <Button
            label={`أجّل الجمعية كلها ${unit}`}
            icon="calendar-outline"
            variant="ghost"
            onPress={() => {
              setDeferOpen(false);
              doPostpone(nextIndex);
            }}
          />
        </ScrollView>
      </Sheet>
      <Sheet visible={speedOpen} title="تسريع الجمعية" onClose={() => setSpeedOpen(false)}>
        <Text variant="caption">
          لو اتفقت مع الأعضاء تخلّصوا بدري. الأدوار اللي قبضت أو ميعادها جه ما بتتغيّرش. ولو عايزين يدفعوا مبلغ زيادة مرة واحدة استخدم "مبلغ إضافي".
        </Text>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.sm }}>
          {speedOptions.map((o) => {
            const end = endWith(o.mode);
            return (
              <Pressable key={o.mode} onPress={() => applySpeed(o.mode, o.title)} style={({ pressed }) => [styles.speedRow, pressed && { opacity: 0.7 }]}>
                <Ionicons name="flash" size={22} color={colors.gold} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="bold">{o.title}</Text>
                  <Text variant="caption">{o.body}</Text>
                  <Text variant="caption" weight="bold" color={colors.success}>
                    تخلص {end ? formatDate(end) : '—'} بدل {plannedEnd ? formatDate(plannedEnd) : '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <View style={styles.amountBox}>
            <Row gap={space.sm}>
              <Ionicons name="calendar-outline" size={22} color={colors.primary} />
              <Text weight="bold" style={{ flex: 1 }}>دفعة زيادة في ميعاد تختاره</Text>
            </Row>
            <Text variant="caption">
              اختار الشهر: كل الأعضاء يدفعوا قسط زيادة يومها، والدور الجاي يتقبض فيه — والجمعية تخلص بدري.
            </Text>
            {pullChoices.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
                {pullChoices.map((d) => (
                  <Chip key={d} label={formatDate(d, false)} active={pullDate === d} onPress={() => setPullDate(d)} />
                ))}
              </ScrollView>
            ) : (
              <Text variant="caption" color={colors.danger}>مفيش شهور فاضية بين المواعيد الجاية.</Text>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {[1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  label={n === 1 ? 'قسط واحد' : n === 2 ? 'قسطين' : '٣ أقساط'}
                  sub={formatMoney(circle.installment * n)}
                  active={pullCount === n}
                  onPress={() => setPullCount(n)}
                />
              ))}
            </View>
            {pullDate ? (
              pulled ? (
                <Text weight="bold" color={colors.success}>
                  كل عضو يدفع {formatMoney(circle.installment * pullCount)} يوم {formatDate(pullDate)} • تخلص {pullEnd ? formatDate(pullEnd) : '—'}
                </Text>
              ) : (
                <Text variant="caption" color={colors.danger}>مفيش أدوار كفاية بعد الميعاد ده.</Text>
              )
            ) : null}
            <Button label="ضيف الدفعة" icon="add-circle-outline" disabled={!pulled} onPress={applyPull} />
            {setDates.map((x) => (
              <Row key={x.date} gap={space.sm}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text variant="caption" weight="semibold" style={{ flex: 1 }}>
                  دفعة زيادة يوم {formatDate(x.date)} ({formatNumber(x.count)} قسط)
                </Text>
                <Text variant="caption" weight="bold" color={colors.danger} onPress={() => cancelPull(x.date)}>
                  إلغاء
                </Text>
              </Row>
            ))}
          </View>
          <View style={styles.amountBox}>
            <Row gap={space.sm}>
              <Ionicons name="cash-outline" size={22} color={colors.primary} />
              <Text weight="bold" style={{ flex: 1 }}>ادفعوا أكتر… وخلّصوا أسرع</Text>
            </Row>
            <Text variant="caption">
              القسط دلوقتي {formatMoney(circle.installment)}. حط المبلغ اللي اتفقتوا عليه لكل ميعاد، والتطبيق يحسب المدة الجديدة.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {[500, 700, 1000].map((x) => (
                <Chip
                  key={x}
                  label={`+${formatNumber(x)}`}
                  sub={formatMoney(circle.installment + x)}
                  active={perDate === circle.installment + x}
                  onPress={() => setPerDateText(String(circle.installment + x))}
                />
              ))}
              <Chip label="الضعف" sub={formatMoney(circle.installment * 2)} active={perDate === circle.installment * 2} onPress={() => setPerDateText(String(circle.installment * 2))} />
            </View>
            <Field label="أو اكتب المبلغ بنفسك" value={perDateText} onChangeText={setPerDateText} keyboardType="numeric" placeholder={`أكتر من ${circle.installment}`} />
            {perDateText.trim() && !amountPlan ? (
              <Text variant="caption" color={colors.danger}>المبلغ لازم يبقى أكبر من القسط الحالي.</Text>
            ) : null}
            {amountPlan ? (
              <View style={{ gap: 2 }}>
                <Text weight="bold" color={colors.success}>
                  {formatNumber(amountPlan.perDateDues.length)} ميعاد بدل {formatNumber(datesNow)} • تخلص {amountEnd ? formatDate(amountEnd) : '—'}
                </Text>
                <Text variant="caption">
                  بدل {plannedEnd ? formatDate(plannedEnd) : '—'}
                  {amountPlan.perDateDues.some((d) => d !== perDate) ? ` • بيتدفع ${[...new Set(amountPlan.perDateDues)].map((d) => formatMoney(d)).join(' أو ')} في الميعاد (في المتوسط ${formatMoney(perDate)})` : ''}
                </Text>
              </View>
            ) : null}
            <Button label="طبّق المبلغ الجديد" icon="flash" disabled={!amountPlan} onPress={applyAmount} />
          </View>
          {sped ? (
            <Button label="رجّع المواعيد العادية" icon="refresh" variant="secondary" onPress={() => applySpeed('normal', '')} />
          ) : null}
        </ScrollView>
      </Sheet>

      <DrawWheel
        visible={wheelOpen}
        entries={wheelEntries}
        onClose={() => setWheelOpen(false)}
        title={
          drawStarted
            ? 'قرعة على الأدوار الجاية'
            : ownerTurn.length
              ? `قرعة الأعضاء (${nameOf(ownerTurn[0].recipientId)} ثابت في الدور الأول)`
              : undefined
        }
        onDone={(order) => {
          setWheelOpen(false);
          const ids = drawable.map((p) => p.id);
          run(() => mutatePeriods(circle.id, (ps) => assignRecipients(ps, ids, orderByRounds(ps, ids, order))), {
            success: 'اتسجّل ترتيب القبض الجديد.',
          });
        }}
      />

      <Sheet
        visible={turnOpen}
        title={turnFor ? `دور إضافي لـ ${turnFor.name} — إمتى؟` : 'دور إضافي لمين؟'}
        onClose={() => {
          setTurnOpen(false);
          setTurnFor(null);
        }}
      >
        {turnFor ? (
          <>
            <Text variant="caption">
              الدور التاني بييجي بعد ما كل الأعضاء ياخدوا دورهم الأول، ومش قبل النهارده. اختار ميعاده، أو حطه في الآخر ووزّع الأدوار الجاية بعجلة القرعة.
            </Text>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.xs }}>
              {extraTurnSlots(circle.periods, turnFor.id, current).map((at) => {
                const last = at >= entries.length;
                const at_ = entries[at];
                const date = last
                  ? endDate({ ...circle, periods: [...circle.periods, { id: 'x', kind: 'payout', recipientId: turnFor.id }] })
                  : at_?.date;
                return (
                  <Pressable
                    key={at}
                    style={({ pressed }) => [styles.speedRow, pressed && { opacity: 0.7 }]}
                    onPress={() => {
                      const m = turnFor;
                      setTurnOpen(false);
                      setTurnFor(null);
                      run(() => mutatePeriods(circle.id, (ps) => addExtraTurn(ps, m.id, last ? undefined : at)), {
                        success: `اتضاف دور لـ ${m.name}${date ? ` يوم ${formatDate(date)}` : ''}.`,
                      });
                    }}
                  >
                    <Ionicons name={last ? 'flag-outline' : 'calendar-outline'} size={22} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text weight="semibold">{date ? formatDate(date) : '—'}</Text>
                      <Text variant="caption">
                        {last ? 'في آخر الجدول' : `مكان دور ${at_?.recipient?.name ?? periodTitle(at_!)} — وده واللي بعده يتأخروا ${unit}`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : (
        <>
        <Text variant="caption">اختار العضو اللي هياخد دور قبض زيادة (سهم تاني، أو عمولة صاحب الجمعية).</Text>
        <ScrollView style={{ flexShrink: 1 }}>
          {circle.members.map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.row, styles.divider, pressed && { opacity: 0.6 }]}
              onPress={() => setTurnFor(m)}
            >
              <Ionicons name="person-circle-outline" size={26} color={colors.primary} />
              <Text style={{ flex: 1 }}>{m.name}</Text>
              <Ionicons name="chevron-back" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
        </>
        )}
      </Sheet>
    </View>
  );
}

/** Pick a later due date for one member's installment in one period. */
function DeferSheet({
  member,
  entry,
  onClose,
  onPick,
}: {
  member: Member | null;
  entry: TimelineEntry;
  onClose: () => void;
  onPick: (date: string | null) => void;
}) {
  const [days, setDays] = useState('');
  const from = entry.date > todayISO() ? entry.date : todayISO();
  const current = member ? deferralOf(entry.period, member.id) : undefined;
  const options = [
    { label: 'أسبوع', d: 7 },
    { label: 'أسبوعين', d: 14 },
    { label: '٣ أسابيع', d: 21 },
    { label: 'شهر', d: 30 },
    { label: 'شهرين', d: 60 },
  ];
  const customDays = Math.round(Number(days.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))));
  return (
    <Sheet visible={!!member} title={member ? `تأجيل قسط ${member.name}` : ''} onClose={onClose}>
      <Text variant="caption">
        {periodTitle(entry)} • ميعاده الأصلي {formatDate(entry.date)}. {member?.name ?? ''} مش هيتحسب متأخر ولا هيوصله تذكير لحد الميعاد الجديد.
      </Text>
      {current ? (
        <Text weight="semibold" color={colors.goldText}>
          مؤجَّل دلوقتي لحد {formatDate(current)}
        </Text>
      ) : null}
      <View style={{ gap: space.sm }}>
        {options.map((o) => (
          <Button
            key={o.d}
            label={`${o.label} — لحد ${formatDate(addDays(from, o.d))}`}
            icon="hourglass-outline"
            variant="secondary"
            singleLine
            onPress={() => onPick(addDays(from, o.d))}
          />
        ))}
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <Field label="أو عدد أيام معيّن" value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={3} placeholder="45" />
          </View>
          <Button
            label="أجّل"
            icon="checkmark"
            disabled={!(customDays >= 1 && customDays <= 365)}
            onPress={() => onPick(addDays(from, customDays))}
            style={{ alignSelf: 'flex-end' }}
          />
        </Row>
        <Text weight="semibold">أو في شهر معيّن (نفس اليوم)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
          {[1, 2, 3, 4, 5, 6].map((k) => {
            const d = addMonths(entry.date, k);
            return <Chip key={k} label={formatDate(d)} active={current === d} onPress={() => onPick(d)} />;
          })}
        </ScrollView>
        {current ? <Button label="إلغاء التأجيل" icon="close-circle-outline" variant="danger" onPress={() => onPick(null)} /> : null}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Members: invites & device links
// ---------------------------------------------------------------------------

function MembersTab({ circle, payments, requests }: { circle: Circle; payments: Payment[]; requests: JoinRequest[] }) {
  const { run } = useAction();
  // The organizer manages from their own account, so they don't "join" as a member.
  const others = circle.members.filter((m) => m.id !== circle.ownerMemberId);
  const joined = others.filter((m) => m.uid).length;


  const unlink = async (m: Member) => {
    if (await confirm('فك ربط الموبايل؟', `${m.name} هيخرج من التطبيق والباسورد بتاعه هيتمسح. يدخل تاني بكود الجمعية ورقمه ويختار باسورد جديد — بنفس اسمه ودوره (لو نسي الباسورد أو غيّر موبايله).`, 'فك الربط', true)) {
      run(() => unlinkMember(circle, m));
    }
  };

  /** Remove the member from the circle entirely (their turn leaves the schedule). */
  const remove = async (m: Member) => {
    if (circle.periods.some((p) => p.kind === 'payout' && p.recipientId === m.id && p.paidOut)) {
      return alert('مينفعش يتمسح', `${m.name} قبض دوره بالفعل، فلازم يكمّل أقساطه في الجمعية.`, undefined, { icon: 'lock-closed', tone: 'info' });
    }
    const paid = payments.filter((p) => p.memberId === m.id).length;
    const msg =
      `${m.name} هيتشال من الجمعية خالص: دوره هيتشال من الجدول، وهيخرج من التطبيق لو كان داخل.` +
      (paid ? ` وعنده ${formatNumber(paid)} دفعة متسجّلة هتفضل في السجل.` : '');
    if (await confirm(`مسح ${m.name}؟`, msg, 'امسح العضو', true)) {
      run(() => saveCircle(circle, circle.members.filter((x) => x.id !== m.id)), { success: `${m.name} اتمسح من الجمعية.` });
    }
  };

  /** Long press: everything you can do with this member. */
  const [editing, setEditing] = useState<Member | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [, bump] = useState(0);
  const startEdit = (m: Member) => {
    setEditName(m.name);
    setEditPhone(m.phone ?? '');
    setEditing(m);
  };
  const saveEdit = () => {
    const m = editing;
    if (!m) return;
    const phone = editPhone.trim();
    if (!editName.trim()) return alert('اكتب الاسم');
    if (phone && !normalizePayAccount(phone)) return alert('رقم الموبايل مش صحيح');
    setEditing(null);
    run(
      async () => {
        await saveCircle(circle, circle.members.map((x) => (x.id === m.id ? { ...x, name: editName.trim(), ...(m.uid ? {} : { phone }) } : x)));
        bump((n) => n + 1);
      },
      { success: 'اتعدّل ✓' },
    );
  };
  /** The member's own message: invite code + their number + their one-time sign-in code. */
  const sendCode = (m: Member, code: string) => {
    const msg = protectionCodeMessage(circle.name, code);
    RNLinking.openURL(whatsappUrl(normalizePhone(m.phone ?? '') ?? '', msg)).catch(() => Share.share({ message: msg }));
  };
  const newCode = async (m: Member) => {
    if (!m.phone) return alert('ضيف رقم موبايل العضو الأول');
    run(async () => {
      // A code that's still waiting to be used is sent again as it is — a new one would
      // cancel the one the member may already have.
      const existing = firstLoginCodeOf(circle.id, m.id);
      if (existing && (await hasLoginCode(circle.id, m.id))) return sendCode(m, existing);
      const code = await issueFirstLoginCode(circle.id, m.id, m.phone!);
      bump((n) => n + 1);
      sendCode(m, code);
    });
  };

  const actions = (m: Member) =>
    alert(m.name, m.uid ? 'داخل من موبايله' : 'لسه ما دخلش', [
      { text: 'عدّل الاسم أو الرقم', icon: 'create-outline' as const, onPress: () => startEdit(m) },
      // One option: a fresh code (the old password / code stops working) sent on WhatsApp.
      ...(!m.uid && m.phone ? [{ text: 'كود دخول (حماية زيادة)', icon: 'shield-checkmark-outline' as const, color: colors.success, onPress: () => newCode(m) }] : []),
      ...(!m.uid ? [{ text: 'يدخل برقمه ويختار باسورد علطول', icon: 'key-outline' as const, onPress: () => run(async () => { await clearFirstLoginCode(circle.id, m.id); bump((n) => n + 1); }, { success: `${m.name} يقدر يدخل دلوقتي بكود الجمعية ورقمه ويختار باسورد.` }) }] : []),
      ...(m.uid ? [{ text: 'فك الربط', icon: 'unlink-outline' as const, onPress: () => unlink(m) }] : []),
      { text: 'امسح العضو', style: 'destructive' as const, icon: 'trash-outline' as const, onPress: () => remove(m) },
      { text: 'إلغاء', style: 'cancel' as const },
    ]);

  return (
    <View style={{ gap: space.md }}>
      {requests.length > 0 && <JoinRequestsCard circle={circle} requests={requests} />}
      <PayInfoCard circle={circle} />
      <InviteCard circle={circle} joined={joined} others={others.length} />

      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        {circle.members.map((m, k) =>
          m.id === circle.ownerMemberId ? (
            <View key={m.id} style={[styles.row, k > 0 && styles.divider]}>
              <Ionicons name="star" size={22} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={1}>
                  {m.name} (إنت)
                </Text>
                <Text variant="caption">صاحب الجمعية — بتديرها من حسابك</Text>
              </View>
              <Badge label="الأدمن" tone="gold" />
            </View>
          ) : (
          <SwipeToDelete key={m.id} onDelete={() => remove(m)} style={k > 0 ? styles.divider : undefined}>
          <Pressable onLongPress={() => actions(m)} delayLongPress={350} style={styles.row}>
            <Ionicons
              name={m.uid ? 'phone-portrait' : 'phone-portrait-outline'}
              size={22}
              color={m.uid ? colors.success : colors.muted}
            />
            <View style={{ flex: 1 }}>
              <Text weight="semibold" numberOfLines={1}>
                {m.name}
              </Text>
              <Text variant="caption">
                {m.uid ? 'داخل من موبايله' : 'لسه ما دخلش'}
                {m.phone ? ` • إنستاباي: ${m.phone}` : ''}
              </Text>
              {!m.uid && firstLoginCodeOf(circle.id, m.id) ? (
                <Text variant="caption" weight="bold" color={colors.primary} onPress={() => sendCode(m, firstLoginCodeOf(circle.id, m.id)!)}>
                  كود الدخول: {'\u2066'}{firstLoginCodeOf(circle.id, m.id)!.replace('-', '')}{'\u2069'} • ابعته واتساب
                </Text>
              ) : null}
            </View>
            <IconButton icon="create-outline" label="تعديل" onPress={() => startEdit(m)} />
            {m.uid ? (
              <IconButton icon="unlink-outline" label="فك الربط" color={colors.danger} bg={colors.dangerSoft} onPress={() => unlink(m)} />
            ) : null}
          </Pressable>
          </SwipeToDelete>
          ),
        )}
      </Card>
      <Text variant="caption" center>
        اسحب العضو لليمين أو دوس عليه دوسة طويلة: تعديل، كود الدخول، فك الربط، أو المسح.
      </Text>

      <Sheet visible={!!editing} title={editing ? `تعديل ${editing.name}` : ''} onClose={() => setEditing(null)}>
        <Field label="الاسم" value={editName} onChangeText={setEditName} maxLength={60} />
        {editing && !editing.uid ? (
          <Field
            label="رقم الموبايل (إنستاباي / فودافون كاش)"
            value={editPhone}
            onChangeText={setEditPhone}
            keyboardType="phone-pad"
            placeholder="01xxxxxxxxx"
            hint="لو غيّرت الرقم، هيتعمل كود دخول جديد للرقم الصح."
          />
        ) : (
          <Text variant="caption">العضو داخل من موبايله، فرقمه بيتغيّر لما تفك الربط ويدخل بالرقم الجديد.</Text>
        )}
        <Button label="حفظ" icon="checkmark" onPress={saveEdit} />
      </Sheet>
    </View>
  );
}

/** Drag a row to the right to reveal a delete button behind it. */
function SwipeToDelete({ children, onDelete, style }: { children: ReactNode; onDelete: () => void; style?: object }) {
  const OPEN = 88;
  const x = useMemo(() => new Animated.Value(0), []);
  const [open, setOpen] = useState(false);
  const settle = (to: number) => {
    setOpen(to !== 0);
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 4 }).start();
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only clear horizontal drags — vertical scrolling stays with the list.
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(OPEN * 1.4, g.dx + (open ? OPEN : 0)))),
        onPanResponderRelease: (_, g) => settle(g.dx + (open ? OPEN : 0) > OPEN / 2 ? OPEN : 0),
        onPanResponderTerminate: () => settle(open ? OPEN : 0),
      }),
    [open],
  );
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <View style={styles.swipeBehind}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="امسح العضو"
          onPress={() => {
            settle(0);
            onDelete();
          }}
          style={styles.swipeDelete}
        >
          <Ionicons name="trash" size={22} color={colors.white} />
          <Text variant="caption" weight="bold" color={colors.white}>
            امسح
          </Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: colors.card }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

/**
 * The invite code + sending it to members' numbers by SMS or WhatsApp.
 * Numbers typed here are remembered on this device so you can see who was invited.
 */
function InviteCard({ circle, joined, others }: { circle: Circle; joined: number; others: number }) {
  const { run } = useAction();
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const key = `dory/invited/${circle.id}`;
  const message = circleInviteMessage(circle, cadenceLabel(circle));
  const open = isCircleOpen(circle);

  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((raw) => raw && setSent(JSON.parse(raw)))
      .catch(() => {});
  }, [key]);

  const remember = (numbers: string[]) => {
    const next = [...new Set([...sent, ...numbers])];
    setSent(next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
  };

  const typed = normalizePhone(phone);
  const addAndSend = (via: 'sms' | 'whatsapp') => {
    if (!typed) return alert('الرقم مش صحيح', 'اكتب رقم موبايل مصري، مثلًا 01012345678.');
    send(via, [typed]);
    setPhone('');
  };

  const send = (via: 'sms' | 'whatsapp', numbers: string[]) => {
    const url = via === 'sms' ? smsUrl(numbers, message, Platform.OS) : whatsappUrl(numbers[0], message);
    RNLinking.openURL(url)
      .then(() => remember(numbers))
      .catch(() =>
        alert(via === 'sms' ? 'مقدرناش نفتح الرسائل' : 'واتساب مش متاح', 'جرّب الطريقة التانية، أو انسخ الرسالة وابعتها بنفسك.'),
      );
  };

  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="mail-unread-outline" size={22} color={colors.primary} />
        <Text variant="heading" style={{ flex: 1 }}>
          دعوة الأعضاء
        </Text>
        <Badge label={open ? 'مفتوحة للانضمام' : 'كملت'} tone={open ? 'success' : 'neutral'} />
      </Row>
      <Text variant="caption">
        {circle.slots
          ? `فيها ${formatNumber(circle.members.length)} من ${formatNumber(circle.slots)} عضو`
          : `فيها ${formatNumber(circle.members.length)} عضو`}
        {' • '}دخل من موبايلاتهم {formatNumber(joined)} من {formatNumber(others)}
      </Text>

      <Text variant="caption" weight="bold">
        كود الدعوة
      </Text>
      <View style={styles.codeBox}>
        <Text variant="number" selectable style={{ letterSpacing: 6, flex: 1, textAlign: 'center' }}>
          {circle.inviteCode}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="انسخ الكود"
          onPress={() => {
            tap();
            Clipboard.setStringAsync(circle.inviteCode).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={({ pressed }) => [styles.copyBtn, copied && styles.copyBtnDone, pressed && { transform: [{ scale: 0.96 }] }]}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.white} />
          <Text weight="bold" color={colors.white}>
            {copied ? 'اتنسخ' : 'نسخ'}
          </Text>
        </Pressable>
      </View>

      <Field
        label="رقم موبايل العضو"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="01xxxxxxxxx"
        hint="هتتبعتله رسالة فيها اسم الجمعية وكود الدعوة"
      />
      <Row gap={space.sm}>
        <Button label="رسالة SMS" icon="chatbubble-ellipses-outline" style={{ flex: 1 }} disabled={!phone.trim()} onPress={() => addAndSend('sms')} />
        <Button
          label="واتساب"
          icon="logo-whatsapp"
          variant="whatsapp"
          style={{ flex: 1 }}
          disabled={!phone.trim()}
          onPress={() => addAndSend('whatsapp')}
        />
      </Row>

      {sent.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <Text variant="caption" weight="bold">
            اتبعتلهم دعوة ({formatNumber(sent.length)})
          </Text>
          {sent.map((n) => (
            <Row key={n} gap={space.sm}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={{ flex: 1 }}>{n.startsWith('20') ? `0${n.slice(2)}` : n}</Text>
              <IconButton icon="chatbubble-ellipses-outline" label="ابعت SMS تاني" onPress={() => send('sms', [n])} />
            </Row>
          ))}
          {sent.length > 1 ? (
            <Button label="ابعت SMS للكل مرة واحدة" icon="people-outline" variant="secondary" onPress={() => send('sms', sent)} />
          ) : null}
        </View>
      ) : null}

      <Row gap={space.sm}>
        <Button
          label="شارك الرسالة"
          icon="share-outline"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => Share.share({ message }).catch(() => {})}
        />
        <Button
          label="غيّر الكود"
          icon="refresh"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={async () => {
            if (await confirm('كود جديد؟', 'الكود القديم هيبطل يشتغل، ولازم تبعت الجديد للي لسه ما دخلوش.', 'غيّر')) {
              run(() => rotateInviteCode(circle));
            }
          }}
        />
      </Row>
    </Card>
  );
}

/** People who entered the code + their name and wait for the admin to let them in. */
function JoinRequestsCard({ circle, requests }: { circle: Circle; requests: JoinRequest[] }) {
  const { run } = useAction();
  const open = circle.members.filter((m) => !m.uid && m.id !== circle.ownerMemberId);
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  const full = !!circle.slots && circle.members.length >= circle.slots;

  const approve = async (r: JoinRequest) => {
    if (full) {
      return alert('الجمعية كملت', `فيها ${formatNumber(circle.members.length)} من ${formatNumber(circle.slots!)} عضو. زوّد العدد من الإعدادات لو عايز تقبل أعضاء أكتر.`);
    }
    const addNew = () => run(() => approveJoin(circle, r), { success: `${r.name} دخل الجمعية ✓ ودوره اتضاف في الجدول.` });
    // Older circles may still have rows typed in by hand — offer to link to one of them.
    if (open.length === 0) {
      if (await confirm('قبول العضو؟', `"${r.name}" هيدخل الجمعية ودوره هيتضاف في آخر الجدول.${r.payAccount ? `\nإنستاباي: ${r.payAccount}` : ''}`, 'قبول')) addNew();
      return;
    }
    const sorted = [...open].sort((a, b) => Number(norm(b.name) === norm(r.name)) - Number(norm(a.name) === norm(r.name)));
    alert(
      `قبول "${r.name}"`,
      'تضيفه عضو جديد، ولا هو واحد من الأسماء اللي في الجدول؟',
      [
        { text: 'عضو جديد', icon: 'person-add' as const, hint: 'دوره يتضاف في آخر الجدول', onPress: addNew },
        ...sorted.map((m) => ({
          text: m.name,
          icon: 'person' as const,
          hint: norm(m.name) === norm(r.name) ? 'نفس الاسم ✓' : 'عضو موجود في الجدول',
          onPress: () => run(() => approveJoin(circle, r, m.id), { success: `${m.name} دخل الجمعية ✓` }),
        })),
        { text: 'إلغاء', style: 'cancel' as const },
      ],
      { icon: 'person-add', tone: 'question' },
    );
  };

  const reject = async (r: JoinRequest) => {
    if (await confirm('رفض الطلب؟', `"${r.name}" مش هيدخل الجمعية.`, 'رفض', true)) run(() => rejectJoin(circle.id, r.uid, r.pushToken));
  };

  return (
    <Card style={{ borderWidth: 1.5, borderColor: colors.gold }}>
      <Row gap={space.sm}>
        <Ionicons name="person-add" size={20} color={colors.gold} />
        <Text variant="heading" style={{ flex: 1 }}>
          طلبات الانضمام
        </Text>
        <Badge label={formatNumber(requests.length)} tone="gold" />
      </Row>
      {requests.map((r) => (
        <View key={r.uid} style={styles.requestRow}>
          <Row gap={space.sm}>
            <View style={styles.requestAvatar}>
              <Ionicons name="person" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="bold" style={{ fontSize: 16 }}>
                {r.name}
              </Text>
              {r.phone ? (
                <Row gap={4}>
                  <Ionicons name="call-outline" size={14} color={colors.primary} />
                  <Text variant="caption">موبايل:</Text>
                  <Text variant="caption" weight="semibold" color={colors.text} numberOfLines={1} style={{ writingDirection: 'ltr' }}>
                    {r.phone.startsWith('20') ? `0${r.phone.slice(2)}` : `+${r.phone}`}
                  </Text>
                </Row>
              ) : null}
              {r.payAccount ? (
                <Row gap={4}>
                  <Ionicons name="flash" size={14} color={colors.gold} />
                  <Text variant="caption">إنستاباي:</Text>
                  <Text variant="caption" weight="semibold" color={colors.text} numberOfLines={1} style={{ writingDirection: 'ltr' }}>
                    {r.payAccount}
                  </Text>
                </Row>
              ) : (
                <Text variant="caption">من غير إنستاباي</Text>
              )}
            </View>
          </Row>
          <Row gap={space.sm}>
            <Button label="موافقة" icon="checkmark" onPress={() => approve(r)} style={{ flex: 2 }} />
            <Button label="رفض" variant="danger" onPress={() => reject(r)} style={{ flex: 1 }} />
          </Row>
        </View>
      ))}
    </Card>
  );
}

/** Where members send InstaPay / Vodafone Cash transfers — shown in their pay sheet. */
function PayInfoCard({ circle }: { circle: Circle }) {
  const [open, setOpen] = useState(false);
  // Older circles: fall back to the organizer's own InstaPay so it's never typed twice.
  const ownerInstapay = circle.members.find((m) => m.id === circle.ownerMemberId)?.phone ?? '';
  const info = circle.payInfo;
  const legacyNumber = info?.instapay ?? ownerInstapay;
  const initialNumber = legacyNumber.includes('@') ? '' : legacyNumber;
  const initialAddress = info?.instapayAddress ?? (legacyNumber.includes('@') ? legacyNumber : '');
  const [number, setNumber] = useState(initialNumber);
  const [address, setAddress] = useState(initialAddress);
  const [vodafone, setVodafone] = useState(info?.vodafoneCash ?? '');
  const { busy, run } = useAction();
  const empty = !info?.instapay && !info?.instapayAddress && !info?.vodafoneCash;
  const numberBad = !!number.trim() && !normalizePhone(number);
  const addressBad = !!address.trim() && !INSTAPAY_ADDRESS.test(address.trim());

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">بيانات التحويل</Text>
        <Button
          label={empty ? 'إضافة' : 'تعديل'}
          icon="create-outline"
          variant="ghost"
          onPress={() => {
            setNumber(initialNumber);
            setAddress(initialAddress);
            setVodafone(info?.vodafoneCash ?? '');
            setOpen(true);
          }}
        />
      </Row>
      {empty ? (
        <Text variant="caption">ضيف رقم وعنوان إنستاباي ورقم فودافون كاش علشان الأعضاء يعرفوا يحوّلوا على فين.</Text>
      ) : (
        <View style={{ gap: space.xs }}>
          {initialNumber ? <Text>⚡ رقم إنستاباي: <Text weight="bold">{initialNumber}</Text></Text> : null}
          {initialAddress ? <Text>⚡ عنوان إنستاباي: <Text weight="bold">{initialAddress}</Text></Text> : null}
          {info?.vodafoneCash ? <Text>📱 فودافون كاش: <Text weight="bold">{info.vodafoneCash}</Text></Text> : null}
        </View>
      )}
      <Sheet visible={open} title="بيانات التحويل" onClose={() => setOpen(false)}>
        <Field
          label="رقم إنستاباي"
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
          placeholder="01xxxxxxxxx"
          maxLength={20}
          error={numberBad ? 'رقم موبايل مش صحيح' : undefined}
        />
        <Field
          label="عنوان إنستاباي"
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@instapay"
          maxLength={60}
          error={addressBad ? 'العنوان لازم يكون زي name@instapay' : undefined}
          hint="الإيصال بيتقبل لو فيه الرقم أو العنوان"
        />
        <Field label="رقم فودافون كاش" value={vodafone} onChangeText={setVodafone} keyboardType="phone-pad" placeholder="010xxxxxxxx" maxLength={20} />
        <Button
          label="حفظ"
          icon="checkmark"
          loading={busy}
          disabled={numberBad || addressBad}
          onPress={() =>
            run(async () => {
              await updatePayInfo(circle.id, { instapay: number, instapayAddress: address, vodafoneCash: vodafone });
              setOpen(false);
            })
          }
        />
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  amountBox: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  deferSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
  },
  earlyBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(201,162,63,0.2)',
    borderWidth: 2,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  swipeBehind: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.danger },
  // Physical left edge in both directions (RN swaps left/right under RTL).
  swipeDelete: { position: 'absolute', top: 0, bottom: 0, width: 88, alignItems: 'center', justifyContent: 'center', gap: 2, ...(I18nManager.isRTL ? { right: 0 } : { left: 0 }) },
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: 2 },
  heroHint: { marginTop: space.sm, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pendingRow: { gap: space.sm, paddingVertical: space.xs },
  check: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkClaimed: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  requestRow: { gap: space.md, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  requestAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  codeBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  copyBtnDone: { backgroundColor: colors.success },
  checkCovered: { backgroundColor: colors.gold, borderColor: colors.gold },
  num: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
