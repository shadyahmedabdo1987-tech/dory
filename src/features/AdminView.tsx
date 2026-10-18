import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, I18nManager, Linking as RNLinking, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  circleInviteMessage,
  normalizePhone,
  INSTAPAY_ADDRESS,
  smsUrl,
  whatsappUrl,
  addExtraInstallment,
  addExtraTurn,
  currentIndex,
  assignRecipients,
  openPayouts,
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
} from '@/core';
import {
  saveCircle,
  backfillPhones,
  syncDirectory,
  approveJoin,
  rejectJoin,
  useJoinRequests,
  type JoinRequest,
  postAnnouncement,
  confirmMany,
  confirmPayment,
  loadPayoutReceipt,
  loadReceipt,
  usePayouts,
  mutatePeriods,
  removePayment,
  rotateInviteCode,
  unlinkMember,
  updatePayInfo,
} from '@/data';
import { Badge, Button, Card, Chip, Field, IconButton, ProgressBar, Row, Segmented, Text, tap } from "@/ui/components";
import { confirm, Sheet, useAction } from '@/ui/feedback';
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
  const phonesKey = circle.members.map((m) => `${m.id}:${m.phone ?? ''}`).join('|');
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
      <Pressable onPress={() => { tap(); setShowTurns(true); }} style={({ pressed }) => [styles.hero, pressed && { opacity: 0.9 }]}>
        <Text variant="caption" color="rgba(255,255,255,0.75)">
          {heroPeriod ? `القبض في دور ${heroEntry?.recipient?.name ?? ''} (${formatDate(heroEntry!.date)})` : 'القبض في كل دور'}
        </Text>
        <Text variant="number" color={colors.gold}>
          {formatMoney(extrasTotal ? headlineTotal : payoutPot(circle, heroPeriod))}
        </Text>
        {extrasTotal ? (
          <Text variant="caption" color="rgba(255,255,255,0.85)">
            القبض {formatMoney(payoutPot(circle, heroPeriod) - heroBonusTotal)} + مبالغ إضافية {formatMoney(extrasTotal)}
          </Text>
        ) : null}
        <Text variant="caption" color="rgba(255,255,255,0.85)">
          {formatNumber(circle.members.length)} عضو × {formatMoney(heroPeriod ? periodDue(circle, heroPeriod) : circle.installment)}{' '}
          {heroPeriod?.bonus ? `(القسط ${formatMoney(circle.installment)} + زيادة ${formatMoney(heroPeriod.bonus)})` : cadenceLabel(circle)}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.75)">
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

  const [review, setReview] = useState<{ payment: Payment; member: Member; entry: TimelineEntry } | null>(null);
  const [recording, setRecording] = useState<{ member: Member; entry: TimelineEntry; method: PaymentMethod } | null>(null);
  const [deferFor, setDeferFor] = useState<Member | null>(null);
  const [payoutFor, setPayoutFor] = useState<TimelineEntry | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<string | null>(null);

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

      {pending.length > 0 && (
        <Card style={{ borderColor: colors.gold }}>
          <Row gap={space.sm}>
            <Ionicons name="notifications" size={20} color={colors.gold} />
            <Text variant="heading">مستني تأكيدك</Text>
          </Row>
          {pending.map(({ payment, entry: e, member }) => (
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
                {entry.index > current && !entry.period.paidOut ? (
                  // The payout opens on its date; before that only the date shows.
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

          {entry.index > current && (
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
    if (e.index > 0 && !started)
      buttons.push({ text: 'طلّعها لفوق', icon: 'arrow-up', onPress: () => run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index - 1))) });
    if (e.index < entries.length - 1 && !started)
      buttons.push({ text: 'نزّلها لتحت', icon: 'arrow-down', onPress: () => run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index + 1))) });
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
          <Button label="تأجيل قسط" icon="pause-circle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => doPostpone(nextIndex)} />
          <Button label="مبلغ إضافي" icon="add-circle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setExtraOpen(true)} />
        </Row>
        <Row gap={space.sm}>
          <Button label="دور إضافي" icon="person-add-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setTurnOpen(true)} />
          <Button
            label="عجلة القرعة"
            icon="sync-circle-outline"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={drawable.length < 2}
            onPress={() => setWheelOpen(true)}
          />
        </Row>
        <Button
          label={sped ? 'الجمعية متسرّعة — غيّر' : 'تسريع الجمعية'}
          icon="flash-outline"
          variant="secondary"
          disabled={circle.periods.length - speedFrom < 2}
          onPress={() => setSpeedOpen(true)}
        />
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
              <Chip label="كل الأدوار الجاية" active={bonusTarget === 'all'} onPress={() => setBonusTarget('all')} />
              {upcomingTurns.map((e) => (
                <Chip
                  key={e.period.id}
                  label={`${e.recipient?.name ?? ''} • ${formatDate(e.date)}`}
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

      <Sheet visible={speedOpen} title="تسريع الجمعية" onClose={() => setSpeedOpen(false)}>
        <Text variant="caption">
          لو اتفقت مع الأعضاء تخلّصوا بدري. الأدوار اللي قبضت أو ميعادها جه ما بتتغيّرش. ولو عايزين يدفعوا مبلغ زيادة مرة واحدة استخدم "مبلغ إضافي".
        </Text>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.sm }}>
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
          run(() => mutatePeriods(circle.id, (ps) => assignRecipients(ps, ids, order)), {
            success: 'اتسجّل ترتيب القبض الجديد.',
          });
        }}
      />

      <Sheet visible={turnOpen} title="دور إضافي لمين؟" onClose={() => setTurnOpen(false)}>
        <Text variant="caption">هيتضاف دور قبض جديد في آخر الجدول للعضو اللي تختاره (سهم تاني، أو عمولة صاحب الجمعية).</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {circle.members.map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.row, styles.divider, pressed && { opacity: 0.6 }]}
              onPress={() => {
                setTurnOpen(false);
                run(() => mutatePeriods(circle.id, (ps) => addExtraTurn(ps, m.id)), { success: `اتضاف دور لـ ${m.name} في آخر الجدول.` });
              }}
            >
              <Ionicons name="person-circle-outline" size={26} color={colors.primary} />
              <Text style={{ flex: 1 }}>{m.name}</Text>
              <Ionicons name="chevron-back" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
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
  const actions = (m: Member) =>
    alert(m.name, m.uid ? 'داخل من موبايله' : 'لسه ما دخلش', [
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
            </View>
            {m.uid ? (
              <IconButton icon="unlink-outline" label="فك الربط" color={colors.danger} bg={colors.dangerSoft} onPress={() => unlink(m)} />
            ) : null}
          </Pressable>
          </SwipeToDelete>
          ),
        )}
      </Card>
      <Text variant="caption" center>
        اسحب العضو لليمين أو دوس عليه دوسة طويلة علشان تمسحه أو تفك ربطه.
      </Text>
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
  const message = circleInviteMessage(circle);
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
