import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import { Linking as RNLinking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addExtraInstallment,
  addExtraTurn,
  currentIndex,
  applyTurnOrder,
  drawablePayouts,
  ownerFirstOrder,
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  inviteMessage,
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
  reminderMessage,
  timeline,
  todayISO,
  whatsappUrl,
  findPayment,
  METHOD_LABEL,
  methodOf,
  PAYMENT_METHODS,
  type Circle,
  type Member,
  type Payment,
  type TimelineEntry,
  type PayoutRequest,
  PAYOUT_STATUS_LABEL,
} from '@/core';
import {
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
import { Badge, Button, Card, Field, IconButton, ProgressBar, Row, Segmented, Text, tap } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

import { DrawWheel } from './DrawWheel';
import { MessagesTab } from './Messaging';
import { AdminPayoutSheet, describePayout, PAYOUT_TONE } from './PayoutSheets';
import { METHOD_COLOR, METHOD_ICON } from './PaySheet';
import { ReceiptViewer } from './ReceiptViewer';
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
  const payouts = usePayouts(circle.id, 'admin', undefined);
  const o = overview(circle, payments);
  const openPayoutRequests = payouts.filter((r) => r.status === 'requested' || r.status === 'disputed').length;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <View style={styles.hero}>
        <Text variant="caption" color="rgba(255,255,255,0.75)">
          القبض في كل دور
        </Text>
        <Text variant="number" color={colors.gold}>
          {formatMoney(payoutPot(circle))}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.85)">
          {formatNumber(circle.members.length)} عضو × {formatMoney(circle.installment)} {FREQUENCY_LABEL[circle.frequency].every}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.75)">
          صاحب الدور ما بيدفعش قسطه وبيستلم {formatMoney(payoutNet(circle))}
        </Text>
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
      </View>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'collect',
            label: o.pendingCount + openPayoutRequests ? `التحصيل (${formatNumber(o.pendingCount + openPayoutRequests)})` : 'التحصيل',
          },
          { value: 'schedule', label: 'الجدول' },
          { value: 'members', label: 'الأعضاء' },
          { value: 'messages', label: 'الرسائل' },
        ]}
      />

      {tab === 'collect' && <CollectTab circle={circle} payments={payments} payouts={payouts} uid={uid} />}
      {tab === 'schedule' && <ScheduleTab circle={circle} payments={payments} />}
      {tab === 'members' && <MembersTab circle={circle} />}
      {tab === 'messages' && <MessagesTab circle={circle} payments={payments} uid={uid} />}
    </ScrollView>
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

  const remind = (m: Member) =>
    RNLinking.openURL(whatsappUrl(m.phone, reminderMessage(circle, m, entry))).catch(() =>
      alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.'),
    );

  const [review, setReview] = useState<{ payment: Payment; member: Member; entry: TimelineEntry } | null>(null);
  const [payoutFor, setPayoutFor] = useState<TimelineEntry | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<string | null>(null);

  const approve = (p: Payment) => run(() => confirmPayment(circle.id, p.periodId, p.memberId, uid));
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
          hint: method === 'cash' ? 'استلمت الفلوس في إيدك' : 'وصل التحويل على حسابك',
          onPress: () => run(() => confirmPayment(circle.id, entry.period.id, m.id, uid, method)),
        })),
        { text: 'إلغاء', style: 'cancel' as const },
      ],
      { icon: 'wallet', tone: 'info' },
    );

  const toggle = (m: Member) => {
    tap();
    const p = findPayment(payments, entry.period.id, m.id);
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
                </Row>
                <Text variant="caption">
                  {formatMoney(e.due)} • {periodTitle(e)} • {formatDate(e.date, false)}
                </Text>
                {payment.note ? <Text variant="caption">“{payment.note}”</Text> : null}
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
                <Button
                  label={
                    entry.period.paidOut
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
              </>
            )}
          </Card>

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
                    {state === 'claimed' && <Ionicons name="time" size={18} color="#8A6A1C" />}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text weight="semibold" numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text variant="caption" color={state === 'confirmed' ? colors.success : colors.muted}>
                      {state === 'confirmed'
                        ? `دفع • ${METHOD_LABEL[methodOf(p)]}`
                        : state === 'claimed'
                          ? `بيقول إنه دفع ${METHOD_LABEL[methodOf(p)]} — دوس للمراجعة`
                          : 'لسه'}
                    </Text>
                  </View>
                  {!state && m.id !== circle.ownerMemberId && (
                    <IconButton icon="logo-whatsapp" label={`ذكّر ${m.name}`} color={colors.white} bg={colors.whatsapp} onPress={() => remind(m)} />
                  )}
                </View>
              );
            })}
          </Card>

          <Button
            label="الكل دفع"
            icon="checkmark-done"
            variant="secondary"
            disabled={s.confirmed.length === s.payers.length}
            onPress={async () => {
              const ids = s.payers.filter((m) => !s.confirmed.includes(m)).map((m) => m.id);
              if (await confirm('تأكيد الكل؟', `هتسجل دفع ${formatNumber(ids.length)} عضو.`, 'سجّل')) {
                run(() => confirmMany(circle.id, entry.period.id, ids, uid));
              }
            }}
          />
        </>
      )}
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
  const { fixed: ownerTurn, open: drawable } = drawablePayouts(circle);
  const nameOf = (id?: string) => circle.members.find((m) => m.id === id)?.name ?? '—';
  const wheelEntries = drawable.map((p) => ({ key: p.id, value: p.recipientId ?? '', name: nameOf(p.recipientId) }));
  const [amount, setAmount] = useState(String(circle.installment));
  const [note, setNote] = useState('');

  const hasPayments = (periodId: string) => payments.some((p) => p.periodId === periodId);
  const anyPayout = circle.periods.some((p) => p.paidOut);
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

  const actions = (e: TimelineEntry) => {
    const started = e.index <= current;
    const buttons: DialogButton[] = [];
    if (!started) buttons.push({ text: `أجّل الفترة دي ${unit}`, icon: 'time', color: '#B7791F', onPress: () => doPostpone(e.index) });
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
          <Button label={`تأجيل ${unit}`} icon="pause-circle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => doPostpone(nextIndex)} />
          <Button label="قسط إضافي" icon="add-circle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setExtraOpen(true)} />
        </Row>
        <Row gap={space.sm}>
          <Button label="دور إضافي" icon="person-add-outline" variant="secondary" style={{ flex: 1 }} onPress={() => setTurnOpen(true)} />
          <Button
            label="عجلة القرعة"
            icon="sync-circle-outline"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={anyPayout || current >= 0}
            onPress={() => setWheelOpen(true)}
          />
        </Row>
        <Text variant="caption">
          دوس على أي فترة لتأجيلها، أو تحريكها، أو حذفها.{current >= 0 || anyPayout ? ' (القرعة بتتقفل بعد ما الجمعية تبدأ.)' : ''}
        </Text>
      </Card>

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

      <Sheet visible={extraOpen} title="قسط إضافي" onClose={() => setExtraOpen(false)}>
        <Text variant="caption">كل الأعضاء هيدفعوا المبلغ ده في الفترة الجاية، ومن غير ما حد يقبض. الأدوار اللي بعدها هتتأخر فترة.</Text>
        <Field label="المبلغ على كل عضو" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <Field label="السبب (اختياري)" value={note} onChangeText={setNote} placeholder="مثلًا: مصاريف إدارية" maxLength={120} />
        <Button
          label="ضيف القسط"
          icon="checkmark"
          disabled={!(parseAmount(amount) > 0)}
          onPress={() => {
            setExtraOpen(false);
            run(() => mutatePeriods(circle.id, (ps) => addExtraInstallment(ps, nextIndex, parseAmount(amount), note.trim())));
            setNote('');
          }}
        />
      </Sheet>

      <DrawWheel
        visible={wheelOpen}
        entries={wheelEntries}
        onClose={() => setWheelOpen(false)}
        title={ownerTurn.length ? `قرعة الأعضاء (${nameOf(ownerTurn[0].recipientId)} ثابت في الدور الأول)` : undefined}
        onDone={(order) => {
          setWheelOpen(false);
          run(() => mutatePeriods(circle.id, (ps) => applyTurnOrder(ps, ownerFirstOrder({ ...circle, periods: ps }, order))), {
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

// ---------------------------------------------------------------------------
// Members: invites & device links
// ---------------------------------------------------------------------------

function MembersTab({ circle }: { circle: Circle }) {
  const { run } = useAction();
  const link = Linking.createURL('/join', { queryParams: { code: circle.inviteCode } });
  // The organizer manages from their own account, so they don't "join" as a member.
  const others = circle.members.filter((m) => m.id !== circle.ownerMemberId);
  const joined = others.filter((m) => m.uid).length;

  const invite = (m: Member) =>
    RNLinking.openURL(whatsappUrl(m.phone, inviteMessage(circle, m, link))).catch(() =>
      alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.'),
    );

  const unlink = async (m: Member) => {
    if (await confirm('فك ربط الموبايل؟', `${m.name} هيخرج من التطبيق، ويقدر يدخل تاني بالكود ورقمه (مثلًا لو غيّر موبايله).`, 'فك الربط', true)) {
      run(() => unlinkMember(circle, m));
    }
  };

  const [copied, setCopied] = useState(false);

  return (
    <View style={{ gap: space.md }}>
      <PayInfoCard circle={circle} />
      <Card style={{ alignItems: 'center' }}>
        <Text variant="caption">كود الجمعية</Text>
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
        <Text variant="caption" center>
          كل عضو يدخل بالكود ده + رقم موبايله المسجل. دخل لحد دلوقتي {formatNumber(joined)} من {formatNumber(others.length)}.
        </Text>
        <Row gap={space.sm} style={{ alignSelf: 'stretch' }}>
          <Button
            label="غيّر الكود"
            icon="refresh"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={async () => {
              if (await confirm('كود جديد؟', 'الكود القديم هيبطل يشتغل للي لسه ما دخلوش.', 'غيّر')) run(() => rotateInviteCode(circle));
            }}
          />
          <Button
            label="شارك"
            icon="share-outline"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              Share.share({ message: `انضم لجمعية "${circle.name}" على تطبيق دوري.\nالكود: ${circle.inviteCode}\n${link}` }).catch(() => {})
            }
          />
        </Row>
      </Card>

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
          <View key={m.id} style={[styles.row, k > 0 && styles.divider]}>
            <Ionicons
              name={m.uid ? 'phone-portrait' : 'phone-portrait-outline'}
              size={22}
              color={m.uid ? colors.success : colors.muted}
            />
            <View style={{ flex: 1 }}>
              <Text weight="semibold" numberOfLines={1}>
                {m.name}
              </Text>
              <Text variant="caption">{m.uid ? 'داخل من موبايله' : m.phone ? 'لسه ما دخلش' : 'مفيش رقم — مش هيقدر يدخل'}</Text>
            </View>
            {m.uid ? (
              <IconButton icon="unlink-outline" label="فك الربط" color={colors.danger} bg={colors.dangerSoft} onPress={() => unlink(m)} />
            ) : m.phone ? (
              <IconButton icon="logo-whatsapp" label={`ابعت دعوة لـ ${m.name}`} color={colors.white} bg={colors.whatsapp} onPress={() => invite(m)} />
            ) : null}
          </View>
          ),
        )}
      </Card>
    </View>
  );
}

/** Where members send InstaPay / Vodafone Cash transfers — shown in their pay sheet. */
function PayInfoCard({ circle }: { circle: Circle }) {
  const [open, setOpen] = useState(false);
  const [instapay, setInstapay] = useState(circle.payInfo?.instapay ?? '');
  const [vodafone, setVodafone] = useState(circle.payInfo?.vodafoneCash ?? '');
  const { busy, run } = useAction();
  const info = circle.payInfo;
  const empty = !info?.instapay && !info?.vodafoneCash;

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">بيانات التحويل</Text>
        <Button
          label={empty ? 'إضافة' : 'تعديل'}
          icon="create-outline"
          variant="ghost"
          onPress={() => {
            setInstapay(info?.instapay ?? '');
            setVodafone(info?.vodafoneCash ?? '');
            setOpen(true);
          }}
        />
      </Row>
      {empty ? (
        <Text variant="caption">ضيف حساب إنستاباي ورقم فودافون كاش علشان الأعضاء يعرفوا يحوّلوا على فين.</Text>
      ) : (
        <View style={{ gap: space.xs }}>
          {info?.instapay ? <Text>⚡ إنستاباي: <Text weight="bold">{info.instapay}</Text></Text> : null}
          {info?.vodafoneCash ? <Text>📱 فودافون كاش: <Text weight="bold">{info.vodafoneCash}</Text></Text> : null}
        </View>
      )}
      <Sheet visible={open} title="بيانات التحويل" onClose={() => setOpen(false)}>
        <Field
          label="عنوان إنستاباي"
          value={instapay}
          onChangeText={setInstapay}
          autoCapitalize="none"
          placeholder="name@instapay أو رقم الموبايل"
          maxLength={60}
        />
        <Field label="رقم فودافون كاش" value={vodafone} onChangeText={setVodafone} keyboardType="phone-pad" placeholder="010xxxxxxxx" maxLength={20} />
        <Button
          label="حفظ"
          icon="checkmark"
          loading={busy}
          onPress={() =>
            run(async () => {
              await updatePayInfo(circle.id, { instapay, vodafoneCash: vodafone });
              setOpen(false);
            })
          }
        />
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: 2 },
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
