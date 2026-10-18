import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
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
  type TimelineEntry, deferralOf, upcomingExtras, currentIndex, cadenceLabel, circleCompletion, earlyPayable, periodSummary } from "@/core";
import { confirmPayoutReceived, disputePayout, hasMyPassword, loadPayoutReceipt, loadReceipt, removePayment, setMyPassword, usePayouts } from '@/data';
import { readPrefsSync, writePrefs } from '@/ui/prefs';
import { Badge, Button, Card, Chip, Field, ProgressBar, Row, Text, tap } from '@/ui/components';
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
  deferred: { label: 'مؤجَّل', tone: 'neutral' },
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
  const [bundle, setBundle] = useState<TimelineEntry[] | undefined>(undefined);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [earlyCount, setEarlyCount] = useState(1);
  const early = earlyPayable(circle, payments, memberId, today);
  const completion = circleCompletion(circle, payments);
  const [viewing, setViewing] = useState<AccountLine | null>(null);

  const [requesting, setRequesting] = useState<TimelineEntry | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<string | null>(null);
  const payouts = usePayouts(circle.id, 'member', memberId);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [showTurns, setShowTurns] = useState(false);

  const confirmReceived = async (periodId: string, amount: number) => {
    if (
      await confirm(
        'اتأكدت إن الفلوس وصلت؟',
        `أكّد بس لو ${formatMoney(amount)} كاملين وصلوا حسابك أو إيدك فعلًا. بعد التأكيد القبض بيتقفل.`,
        'أيوه، وصلوني',
      )
    ) {
      run(() => confirmPayoutReceived(circle.id, periodId), { success: 'شكرًا! صاحب الجمعية هيوصله تأكيدك.' });
    }
  };

  const claim = (line: AccountLine) => {
    setBundle(undefined);
    setPaying(line.entry);
  };
  const payEarly = () => {
    const chosen = early.slice(0, Math.max(1, Math.min(earlyCount, early.length)));
    setEarlyOpen(false);
    setBundle(chosen);
    setPaying(chosen[0]);
  };

  const undo = async (line: AccountLine) => {
    if (await confirm('تراجع؟', 'هنشيل البلاغ بتاعك إنك دفعت القسط ده.', 'تراجع', true)) {
      if (line.payment) run(() => removePayment(circle.id, line.payment!));
    }
  };

  const next = acc.nextDue;
  const paidRatio = acc.totalCommitment ? acc.totalPaid / acc.totalCommitment : 0;
  // Extra amounts the organizer added that this member still pays (already inside the totals above).
  const extraLines = upcomingExtras(circle, currentIndex(circle)).filter(
    (x) => !(x.kind === 'bonus' && x.entry.period.recipientId === memberId),
  );

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
            {cadenceLabel(circle)}
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
        {extraLines.length ? (
          <View style={{ gap: 2, marginTop: space.xs }}>
            {extraLines.map((x) => (
              <Text key={x.entry.period.id} variant="caption" weight="bold" color="#FFD6A5">
                ➕ {x.kind === 'bonus' ? 'زيادة على القسط' : 'قسط إضافي'} ({formatDate(x.entry.date)}): {formatMoney(x.perMember)}
                {x.entry.period.note ? ` — ${x.entry.period.note}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
        {completion.done ? (
          <View style={styles.donePill}>
            <Ionicons name="trophy" size={22} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Text weight="bold" color={colors.white}>
                الجمعية انتهت 🎉
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.85)">
                كل الأقساط اتسددت وكل الأعضاء قبضوا أدوارهم.
              </Text>
            </View>
          </View>
        ) : acc.remaining <= 0 && acc.totalCommitment > 0 ? (
          <View style={styles.donePill}>
            <Ionicons name="shield-checkmark" size={22} color={colors.gold} />
            <Text weight="bold" color={colors.white} style={{ flex: 1 }}>
              سددت كل أقساطك ✓ مفيش عليك حاجة تاني
            </Text>
          </View>
        ) : null}
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

      <PasswordCard cid={circle.id} memberId={memberId} />

      <AnnouncementsCard circle={circle} memberId={memberId} />

      {acc.overdueAmount > 0 && (
        <Row style={styles.alert}>
          <Ionicons name="alert-circle" size={22} color={colors.danger} />
          <Text color={colors.danger} weight="semibold" style={{ flex: 1 }}>
            عليك متأخرات {formatMoney(acc.overdueAmount)} ({formatNumber(acc.overdue.length)} قسط)
          </Text>
        </Row>
      )}

      {early.length > 0 && !completion.done ? (
        <Card style={{ borderColor: colors.primary }}>
          <Row gap={space.sm}>
            <View style={styles.earlyIcon}>
              <Ionicons name="flash" size={20} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">سداد معجّل</Text>
              <Text variant="caption">
                عايز تخلّص بدري؟ ادفع قسط أو أكتر — أو الجمعية كلها — مرة واحدة. أول ما صاحب الجمعية يوافق، يتعلّموا مدفوعين.
              </Text>
            </View>
          </Row>
          <Button
            label="سدّد أقساط مقدّمًا"
            icon="flash-outline"
            onPress={() => {
              setEarlyCount(1);
              setEarlyOpen(true);
            }}
          />
        </Card>
      ) : null}

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
              {deferralOf(next.entry.period, memberId) ? (
                <Text variant="caption" weight="bold" color={colors.primary}>
                  صاحب الجمعية أجّله لحد {formatDate(deferralOf(next.entry.period, memberId)!)}
                </Text>
              ) : null}
            </View>
            {next.entry.period.kind === 'extra' && <Badge label="قسط إضافي" tone="gold" />}
          </Row>
          {next.entry.date > today ? (
            <Row gap={space.xs}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
              <Text variant="caption" style={{ flex: 1 }}>
                الدفع بيفتح يوم {formatDate(next.entry.date)}
              </Text>
              <Text variant="caption" weight="bold" color={colors.primary} onPress={() => claim(next)}>
                سداد مبكر
              </Text>
            </Row>
          ) : (
            <Button label="دفعت القسط ده" icon="checkmark-circle-outline" loading={busy} onPress={() => claim(next)} />
          )}
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
                      : request.method === 'cash'
                        ? `صاحب الجمعية سجّل إنه سلّمك ${formatMoney(p.amount)} كاش. عدّهم وأكّد إنك استلمت.`
                        : `صاحب الجمعية سجّل إنه حوّلك ${formatMoney(p.amount)} — ${describePayout(request)}. افتح حسابك واتأكد إن المبلغ كامل وصل فعلًا. لو ما وصلش، ما تدوسش "استلمت" ودوس "ما وصلنيش".`}
                  </Text>
                  {request.hasReceipt && (
                    <Button label="عرض إيصال التحويل" icon="image-outline" variant="secondary" onPress={() => setPayoutReceipt(p.entry.period.id)} />
                  )}
                  <View style={{ gap: space.sm }}>
                    <Button
                      label="استلمت الفلوس ✓"
                      icon="checkmark-done"
                      loading={busy}
                      style={{ backgroundColor: colors.success, borderColor: colors.success }}
                      onPress={() => confirmReceived(p.entry.period.id, p.amount)}
                    />
                    {request.status !== 'disputed' && (
                      <Button
                        label="ما وصلنيش"
                        icon="alert-circle-outline"
                        variant="danger"
                        onPress={() => {
                          setDisputeNote('');
                          setDisputing(p.entry.period.id);
                        }}
                      />
                    )}
                  </View>
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
              ) : editable && (p.entry.date <= today || periodSummary(circle, payments, p.entry.index).isComplete) ? (
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
          // Collection opens on the installment's date — nothing is paid ahead of it.
          const canClaim = (line.state === 'overdue' || line.state === 'due' || line.state === 'deferred') && line.entry.date <= today;
          // Paying a coming installment ahead of time: goes to the organizer as an early-payment request.
          const earlyOk = line.state === 'upcoming' && line.entry.due > 0 && !line.isMyPayout && line.entry.date > today;
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
                {earlyOk && (
                  <Text variant="caption" color={colors.primary} weight="bold" onPress={() => claim(line)}>
                    سداد مبكر
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
      <PaySheet
        circle={circle}
        entry={paying}
        bundle={bundle}
        memberId={memberId}
        uid={uid}
        onClose={() => {
          setPaying(null);
          setBundle(undefined);
        }}
      />
      <Sheet visible={earlyOpen} title="سداد معجّل" onClose={() => setEarlyOpen(false)}>
        <Text variant="caption">هتدفع كام قسط؟ بيتحسبوا بالترتيب من أقرب قسط جاي.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 4 }}>
          {early.map((e, k) => {
            const n = k + 1;
            const sum = early.slice(0, n).reduce((t, x) => t + x.due, 0);
            return (
              <Chip
                key={e.period.id}
                label={n === early.length && n > 1 ? 'كل اللي عليّ' : `${formatNumber(n)} قسط`}
                sub={formatMoney(sum)}
                active={earlyCount === n}
                onPress={() => setEarlyCount(n)}
              />
            );
          })}
        </ScrollView>
        {early.length ? (
          <View style={styles.earlySummary}>
            <Text variant="caption">الإجمالي</Text>
            <Text variant="number" color={colors.primary}>
              {formatMoney(early.slice(0, earlyCount).reduce((t, x) => t + x.due, 0))}
            </Text>
            <Text variant="caption">
              {formatNumber(Math.min(earlyCount, early.length))} قسط • لحد {formatDate(early[Math.min(earlyCount, early.length) - 1].date)}
            </Text>
          </View>
        ) : null}
        <Button label="كمّل للدفع" icon="arrow-back" onPress={payEarly} />
      </Sheet>
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

/**
 * Members who joined before passwords existed choose one once; from then on
 * signing back in needs the code + their number + this password.
 */
function PasswordCard({ cid, memberId }: { cid: string; memberId: string }) {
  const [needed, setNeeded] = useState(false);
  const [phone, setPhone] = useState(() => readPrefsSync().myPhone ?? '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const { busy, run } = useAction();

  useEffect(() => {
    let alive = true;
    hasMyPassword(cid, memberId).then((has) => alive && setNeeded(!has));
    return () => {
      alive = false;
    };
  }, [cid, memberId]);

  if (!needed) return null;
  const ok = !!phone.trim() && password.length >= 6 && password === password2;
  const save = () =>
    run(
      async () => {
        await setMyPassword(cid, memberId, phone, password);
        writePrefs({ myPhone: phone.trim() });
        setNeeded(false);
      },
      { success: 'الباسورد اتحفظ ✓ — بعد كده تدخل بالكود ورقمك والباسورد.' },
    );

  return (
    <Card style={{ borderWidth: 1.5, borderColor: colors.gold }}>
      <Row gap={space.sm}>
        <Ionicons name="lock-closed" size={20} color={colors.gold} />
        <Text variant="heading" style={{ flex: 1 }}>
          اختار باسورد لحسابك
        </Text>
      </Row>
      <Text variant="caption">
        علشان محدش يقدر يدخل مكانك. لما تعمل خروج وترجع، هتدخل بكود الجمعية ورقم موبايلك والباسورد ده.
      </Text>
      <Field
        label="رقم موبايلك"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="01xxxxxxxxx"
        style={{ textAlign: 'left', writingDirection: 'ltr' }}
      />
      <Field label="الباسورد" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" error={password && password.length < 6 ? '٦ حروف أو أكتر' : undefined} />
      <Field label="اكتب الباسورد تاني" value={password2} onChangeText={setPassword2} secureTextEntry autoCapitalize="none" error={password2 && password2 !== password ? 'الباسورد مش زي اللي فوق' : undefined} />
      <Button label="احفظ الباسورد" icon="lock-closed-outline" loading={busy} disabled={!ok} onPress={save} />
    </Card>
  );
}

const styles = StyleSheet.create({
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  earlyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  earlySummary: {
    alignItems: 'center',
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
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
