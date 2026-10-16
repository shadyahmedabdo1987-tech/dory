import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  memberAccount,
  periodTitle,
  relativeDays,
  daysBetween,
  awaitingRecipientConfirmation,
  canEditPayoutRequest,
  METHOD_LABEL,
  methodOf,
  PAYOUT_STATUS_LABEL,
  todayISO,
  paymentId,
  type AccountLine,
  type Circle,
  type MemberPaymentState,
  type Payment,
  type TimelineEntry,
} from '@/core';
import { confirmPayoutReceived, disputePayout, loadPayoutReceipt, loadReceipt, removePayment, usePayouts } from '@/data';
import { Badge, Button, Card, Field, ProgressBar, Row, Text, tap } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { KeyboardScreen } from '@/ui/KeyboardScreen';
import { colors, radius, space } from '@/ui/theme';

import { AnnouncementsCard } from './Messaging';
import { PaySheet } from './PaySheet';
import { describePayout, PAYOUT_TONE, PayoutRequestSheet } from './PayoutSheets';
import { ReceiptViewer } from './ReceiptViewer';
import { TurnsSheet } from './TurnsSheet';

const STATE_BADGE: Record<MemberPaymentState, { label: string; tone: 'success' | 'gold' | 'danger' | 'neutral' } | null> = {
  covered: { label: 'دورك — محسوب مدفوع', tone: 'success' },
  confirmed: { label: 'مدفوع ✓', tone: 'success' },
  claimed: { label: 'مستني التأكيد', tone: 'gold' },
  overdue: { label: 'متأخر', tone: 'danger' },
  due: { label: 'مستحق', tone: 'gold' },
  upcoming: { label: 'جاي', tone: 'neutral' },
  none: null,
};

/** Bank-style account screen for a member. */
export function MemberView({
  circle,
  payments,
  memberId,
  uid,
}: {
  circle: Circle;
  payments: Payment[];
  memberId: string;
  uid: string;
}) {
  const insets = useSafeAreaInsets();
  const today = todayISO();
  const acc = memberAccount(circle, payments, memberId, today);
  const { busy, run } = useAction();

  const [paying, setPaying] = useState<TimelineEntry | null>(null);
  const [viewing, setViewing] = useState<AccountLine | null>(null);

  const [requesting, setRequesting] = useState<TimelineEntry | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<string | null>(null);
  const payouts = usePayouts(circle.id, 'member', memberId);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [showTurns, setShowTurns] = useState(false);

  const confirmReceived = async (periodId: string, amount: number) => {
    if (await confirm('تأكيد الاستلام', `هتأكد إنك استلمت ${formatMoney(amount)} كاملين.`, 'أيوه استلمت')) {
      run(() => confirmPayoutReceived(circle.id, periodId), { success: 'شكرًا! صاحب الجمعية هيوصله تأكيدك.' });
    }
  };

  const claim = (line: AccountLine) => setPaying(line.entry);

  const undo = async (line: AccountLine) => {
    if (await confirm('تراجع؟', 'هنشيل البلاغ بتاعك إنك دفعت القسط ده.', 'تراجع', true)) {
      if (line.payment) run(() => removePayment(circle.id, line.payment!));
    }
  };

  const next = acc.nextDue;
  const paidRatio = acc.totalCommitment ? acc.totalPaid / acc.totalCommitment : 0;

  return (
    <KeyboardScreen>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      {/* Balance card */}
      <Pressable onPress={() => { tap(); setShowTurns(true); }} style={({ pressed }) => [styles.balance, pressed && { opacity: 0.9 }]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="caption" color="rgba(255,255,255,0.75)">
            أهلًا يا {acc.member.name}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.75)">
            {FREQUENCY_LABEL[circle.frequency].every}
          </Text>
        </Row>
        <Text variant="caption" color="rgba(255,255,255,0.75)" style={{ marginTop: space.sm }}>
          اللي دفعته لحد دلوقتي
        </Text>
        <Text variant="number" color={colors.white}>
          {formatMoney(acc.totalPaid)}
        </Text>
        <ProgressBar value={paidRatio} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="caption" color="rgba(255,255,255,0.85)">
            باقي عليك {formatMoney(acc.remaining)}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.85)">
            من {formatMoney(acc.totalCommitment)}
          </Text>
        </Row>
        {acc.myPayouts.length ? (() => {
          const t = acc.myPayouts.find((p) => !p.received) ?? acc.myPayouts[acc.myPayouts.length - 1];
          const d = daysBetween(today, t.entry.date);
          return (
            <Row gap={space.xs} style={styles.myTurnPill}>
              <Ionicons name="gift" size={16} color={colors.white} />
              <Text variant="caption" weight="bold" color={colors.white}>
                {t.received ? `قبضت دورك يوم ${formatDate(t.entry.date)} ✓` : `دورك في القبض: ${formatDate(t.entry.date)} (${d === 0 ? 'النهارده' : relativeDays(d)})`}
              </Text>
            </Row>
          );
        })() : null}
        <Row gap={4} style={styles.heroHint}>
          <Text variant="caption" weight="semibold" color={colors.white}>
            اضغط تشوف الأدوار والسداد
          </Text>
          <Ionicons name="chevron-back" size={14} color={colors.white} />
        </Row>
      </Pressable>
      <TurnsSheet visible={showTurns} onClose={() => setShowTurns(false)} circle={circle} payments={payments} memberId={memberId} />

      <AnnouncementsCard circle={circle} memberId={memberId} />

      {acc.overdueAmount > 0 && (
        <Row style={styles.alert}>
          <Ionicons name="alert-circle" size={22} color={colors.danger} />
          <Text color={colors.danger} weight="semibold" style={{ flex: 1 }}>
            عليك متأخرات {formatMoney(acc.overdueAmount)} ({formatNumber(acc.overdue.length)} قسط)
          </Text>
        </Row>
      )}

      {/* Next installment */}
      {next && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">{next.state === 'overdue' ? 'قسط متأخر' : 'القسط الجاي'}</Text>
            {STATE_BADGE[next.state] && <Badge {...STATE_BADGE[next.state]!} />}
          </Row>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text variant="number">{formatMoney(next.entry.due)}</Text>
              <Text variant="caption">
                {formatDate(next.entry.date)} • {relativeDays(daysBetween(today, next.entry.date))}
              </Text>
            </View>
            {next.entry.period.kind === 'extra' && <Badge label="قسط إضافي" tone="gold" />}
          </Row>
          <Button label="دفعت القسط ده" icon="checkmark-circle-outline" loading={busy} onPress={() => claim(next)} />
        </Card>
      )}

      {/* Payout */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">دورك في القبض</Text>
          <Ionicons name="gift" size={22} color={colors.gold} />
        </Row>
        {acc.myPayouts.length === 0 && <Text variant="caption">مفيش دور ليك في الجدول.</Text>}
        {acc.myPayouts.map((p) => {
          const request = payouts.find((r) => r.periodId === p.entry.period.id);
          const editable = !p.received && canEditPayoutRequest(request);
          return (
            <View key={p.entry.period.id} style={styles.payout}>
              <Row gap={space.md}>
                <View style={{ flex: 1 }}>
                  <Text weight="bold">{formatMoney(p.amount)}</Text>
                  <Text variant="caption">
                    {formatDate(p.entry.date)}
                    {!p.received ? ` • ${relativeDays(daysBetween(today, p.entry.date))}` : ''}
                  </Text>
                  <Text variant="caption" color={colors.success}>
                    مش هتدفع قسط الدور ده — محسوب مدفوع
                  </Text>
                </View>
                <Badge
                  label={p.received ? 'استلمت ✓' : `الدور رقم ${formatNumber(p.entry.index + 1)}`}
                  tone={p.received ? 'success' : 'gold'}
                />
              </Row>

              {request ? (
                <View style={{ gap: 2 }}>
                  <Row gap={space.xs}>
                    <Text variant="caption" weight="semibold" color={colors.text}>
                      {describePayout(request)}
                    </Text>
                    {!p.received && <Badge label={PAYOUT_STATUS_LABEL[request.status]} tone={PAYOUT_TONE[request.status]} />}
                  </Row>
                  {request.adminNote ? <Text variant="caption">صاحب الجمعية: “{request.adminNote}”</Text> : null}
                </View>
              ) : null}

              {request && (awaitingRecipientConfirmation(request) || request.status === 'disputed') ? (
                <View style={styles.confirmBox}>
                  <Text weight="bold">{request.status === 'disputed' ? 'وصلك القبض خلاص؟' : 'وصلك القبض؟'}</Text>
                  <Text variant="caption">
                    {request.status === 'disputed'
                      ? `قلت إنه ما وصلش${request.disputeNote ? `: "${request.disputeNote}"` : ''}. لو وصل، أكّد الاستلام.`
                      : `صاحب الجمعية سجّل إنه سلّمك ${describePayout(request)}. أكّد إنك استلمت.`}
                  </Text>
                  {request.hasReceipt && (
                    <Button label="عرض إيصال التحويل" icon="image-outline" variant="secondary" onPress={() => setPayoutReceipt(p.entry.period.id)} />
                  )}
                  <Row gap={space.sm}>
                    {request.status !== 'disputed' && (
                      <Button
                        label="ما وصلنيش"
                        icon="alert-circle-outline"
                        variant="danger"
                        style={{ flex: 1 }}
                        onPress={() => {
                          setDisputeNote('');
                          setDisputing(p.entry.period.id);
                        }}
                      />
                    )}
                    <Button
                      label="استلمت ✓"
                      icon="checkmark-done"
                      loading={busy}
                      style={{ flex: 2, backgroundColor: colors.success, borderColor: colors.success }}
                      onPress={() => confirmReceived(p.entry.period.id, p.amount)}
                    />
                  </Row>
                </View>
              ) : request?.status === 'received' ? (
                <Row gap={space.sm}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.success} />
                  <Text variant="caption" color={colors.success} weight="semibold" style={{ flex: 1 }}>
                    أكدت الاستلام{request.receivedAt ? ` • ${formatDate(request.receivedAt.slice(0, 10))}` : ''}
                  </Text>
                  {request.hasReceipt && (
                    <Text variant="caption" color={colors.primary} weight="bold" onPress={() => setPayoutReceipt(p.entry.period.id)}>
                      الإيصال
                    </Text>
                  )}
                </Row>
              ) : p.received && request?.hasReceipt ? (
                <Button label="عرض إيصال تحويل القبض" icon="image-outline" variant="secondary" onPress={() => setPayoutReceipt(p.entry.period.id)} />
              ) : editable && p.entry.date <= today ? (
                <Button
                  label={request ? 'تعديل طريقة القبض' : 'حدد طريقة القبض'}
                  icon="wallet-outline"
                  variant={request ? 'ghost' : 'primary'}
                  onPress={() => setRequesting(p.entry)}
                />
              ) : editable ? (
                // The payout opens on its date; before that only the date shows.
                <Row gap={space.xs}>
                  <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
                  <Text variant="caption">طلب القبض بيفتح يوم {formatDate(p.entry.date)}</Text>
                </Row>
              ) : null}
            </View>
          );
        })}
      </Card>

      {/* Statement */}
      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        <Text variant="heading" style={{ paddingVertical: space.sm }}>
          كشف الحساب
        </Text>
        {acc.lines.map((line) => {
          const badge = STATE_BADGE[line.state];
          const canClaim = line.state === 'overdue' || line.state === 'due';
          return (
            <View key={line.entry.period.id} style={styles.line}>
              <View style={[styles.dot, line.isMyPayout && { backgroundColor: colors.gold }]}>
                <Ionicons
                  name={line.entry.period.kind === 'skip' ? 'pause' : line.isMyPayout ? 'gift' : 'arrow-up'}
                  size={14}
                  color={line.isMyPayout ? colors.white : colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={1}>
                  {line.isMyPayout ? 'دورك تقبض' : periodTitle(line.entry)}
                </Text>
                <Text variant="caption">
                  {formatDate(line.entry.date)}
                  {line.payment && line.state !== 'covered' ? ` • ${METHOD_LABEL[methodOf(line.payment)]}` : ''}
                </Text>
                {line.payment?.hasReceipt ? (
                  <Text variant="caption" color={colors.primary} weight="semibold" onPress={() => setViewing(line)}>
                    عرض صورة التحويل
                  </Text>
                ) : null}
                {line.entry.period.note ? <Text variant="caption">{line.entry.period.note}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                {line.entry.due > 0 && <Text weight="bold">{formatMoney(line.entry.due)}</Text>}
                {badge && <Badge {...badge} />}
                {canClaim && (
                  <Text variant="caption" color={colors.primary} weight="bold" onPress={() => claim(line)}>
                    دفعت؟
                  </Text>
                )}
                {line.state === 'claimed' && (
                  <Text variant="caption" color={colors.muted} onPress={() => undo(line)}>
                    تراجع
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </Card>
      <PaySheet circle={circle} entry={paying} memberId={memberId} uid={uid} onClose={() => setPaying(null)} />
      <PayoutRequestSheet
        circle={circle}
        entry={requesting}
        request={requesting ? payouts.find((r) => r.periodId === requesting.period.id) : undefined}
        memberId={memberId}
        uid={uid}
        onClose={() => setRequesting(null)}
      />
      <Sheet visible={!!disputing} title="القبض ما وصلش" onClose={() => setDisputing(null)}>
        <Text variant="caption">قول لصاحب الجمعية إيه اللي حصل، وهيوصله إشعار فورًا.</Text>
        <Field
          label="التفاصيل"
          value={disputeNote}
          onChangeText={setDisputeNote}
          placeholder="مثلًا: التحويل ما ظهرش في المحفظة لحد دلوقتي"
          maxLength={200}
          multiline
        />
        <Button
          label="ابعت لصاحب الجمعية"
          icon="send"
          variant="danger"
          loading={busy}
          onPress={() =>
            run(async () => {
              await disputePayout(circle.id, disputing!, disputeNote);
              setDisputing(null);
            })
          }
        />
      </Sheet>
      <ReceiptViewer
        source={payoutReceipt ? { key: `payout-${payoutReceipt}`, load: () => loadPayoutReceipt(circle.id, payoutReceipt) } : null}
        title="إيصال تحويل القبض"
        onClose={() => setPayoutReceipt(null)}
      />
      <ReceiptViewer
        source={
          viewing
            ? {
                key: paymentId(viewing.entry.period.id, memberId),
                load: () => loadReceipt(circle.id, paymentId(viewing.entry.period.id, memberId)),
              }
            : null
        }
        title="صورة التحويل"
        subtitle={viewing ? `${formatMoney(viewing.entry.due)} • ${formatDate(viewing.entry.date)}` : undefined}
        onClose={() => setViewing(null)}
      />
    </ScrollView>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  balance: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
  myTurnPill: { marginTop: space.sm, alignSelf: 'stretch', justifyContent: 'center', backgroundColor: colors.orange, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  heroHint: { marginTop: space.sm, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 4 },
  alert: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, gap: space.sm },
  payout: { backgroundColor: colors.goldSoft, borderRadius: radius.sm, padding: space.md, gap: space.sm },
  confirmBox: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.gold },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
