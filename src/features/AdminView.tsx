import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import { Alert, Linking as RNLinking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addExtraInstallment,
  addExtraTurn,
  currentIndex,
  drawTurns,
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  groupSummaryMessage,
  inviteMessage,
  movePeriod,
  overview,
  parseAmount,
  payoutPot,
  pendingApprovals,
  periodSummary,
  periodTitle,
  postpone,
  removePeriod,
  reminderMessage,
  setPaidOut,
  timeline,
  todayISO,
  whatsappUrl,
  findPayment,
  type Circle,
  type Member,
  type Payment,
  type TimelineEntry,
} from '@/core';
import {
  confirmMany,
  confirmPayment,
  mutatePeriods,
  removePayment,
  rotateInviteCode,
  unlinkMember,
} from '@/data';
import { Badge, Button, Card, Field, IconButton, ProgressBar, Row, Segmented, Text, tap } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

export type AdminTab = 'collect' | 'schedule' | 'members';

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
  const o = overview(circle, payments);

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
          { value: 'collect', label: o.pendingCount ? `التحصيل (${formatNumber(o.pendingCount)})` : 'التحصيل' },
          { value: 'schedule', label: 'الجدول' },
          { value: 'members', label: 'الأعضاء' },
        ]}
      />

      {tab === 'collect' && <CollectTab circle={circle} payments={payments} uid={uid} />}
      {tab === 'schedule' && <ScheduleTab circle={circle} payments={payments} />}
      {tab === 'members' && <MembersTab circle={circle} />}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Collection: approvals + one period at a time
// ---------------------------------------------------------------------------

function CollectTab({ circle, payments, uid }: { circle: Circle; payments: Payment[]; uid: string }) {
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
      Alert.alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.'),
    );

  const toggle = (m: Member) => {
    tap();
    const p = findPayment(payments, entry.period.id, m.id);
    if (p?.status === 'confirmed') {
      Alert.alert('إلغاء الدفع؟', `هتشيل دفع ${m.name} للفترة دي.`, [
        { text: 'لأ', style: 'cancel' },
        { text: 'شيل', style: 'destructive', onPress: () => run(() => removePayment(circle.id, entry.period.id, m.id)) },
      ]);
    } else run(() => confirmPayment(circle.id, entry.period.id, m.id, uid));
  };

  const togglePayout = async () => {
    if (!entry.period.paidOut && !s.isComplete) {
      const ok = await confirm('لسه في ناس ما دفعتش', 'متأكد إنك سلّمت القبض؟', 'أيوه سلّمت');
      if (!ok) return;
    }
    run(() => mutatePeriods(circle.id, (ps) => setPaidOut(ps, entry.period.id, !entry.period.paidOut)));
  };

  return (
    <View style={{ gap: space.md }}>
      {pending.length > 0 && (
        <Card style={{ borderColor: colors.gold }}>
          <Row gap={space.sm}>
            <Ionicons name="notifications" size={20} color={colors.gold} />
            <Text variant="heading">مستني تأكيدك</Text>
          </Row>
          {pending.map(({ payment, entry: e, member }) => (
            <Row key={payment.id} style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{member.name}</Text>
                <Text variant="caption">
                  {formatMoney(e.due)} • {periodTitle(e)} • {formatDate(e.date, false)}
                </Text>
                {payment.note ? <Text variant="caption">“{payment.note}”</Text> : null}
              </View>
              <IconButton
                icon="close"
                label="رفض"
                color={colors.danger}
                bg={colors.dangerSoft}
                onPress={() => run(() => removePayment(circle.id, payment.periodId, payment.memberId))}
              />
              <IconButton
                icon="checkmark"
                label="تأكيد"
                color={colors.white}
                bg={colors.success}
                onPress={() => run(() => confirmPayment(circle.id, payment.periodId, payment.memberId, uid))}
              />
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
                {formatNumber(s.confirmed.length)}/{formatNumber(circle.members.length)}
              </Text>
            </Row>
            <ProgressBar value={s.pot ? s.collected / s.pot : 0} color={s.isComplete ? colors.success : colors.gold} />
            {entry.period.kind === 'payout' && (
              <Button
                label={entry.period.paidOut ? `${entry.recipient?.name ?? ''} استلم ✓ (إلغاء)` : `سلّمت القبض لـ ${entry.recipient?.name ?? ''}`}
                icon={entry.period.paidOut ? 'arrow-undo-outline' : 'cash-outline'}
                variant={entry.period.paidOut ? 'secondary' : 'primary'}
                onPress={togglePayout}
              />
            )}
          </Card>

          <Card style={{ gap: 0, paddingVertical: space.sm }}>
            {circle.members.map((m, k) => {
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
                      {state === 'confirmed' ? 'دفع' : state === 'claimed' ? 'بيقول إنه دفع — دوس للتأكيد' : 'لسه'}
                    </Text>
                  </View>
                  {!state && (
                    <IconButton icon="logo-whatsapp" label={`ذكّر ${m.name}`} color={colors.white} bg={colors.whatsapp} onPress={() => remind(m)} />
                  )}
                </View>
              );
            })}
          </Card>

          <Row gap={space.sm}>
            <Button
              label="الكل دفع"
              icon="checkmark-done"
              variant="secondary"
              style={{ flex: 1 }}
              disabled={s.confirmed.length === circle.members.length}
              onPress={async () => {
                const ids = circle.members.filter((m) => !s.confirmed.includes(m)).map((m) => m.id);
                if (await confirm('تأكيد الكل؟', `هتسجل دفع ${formatNumber(ids.length)} عضو.`, 'سجّل')) {
                  run(() => confirmMany(circle.id, entry.period.id, ids, uid));
                }
              }}
            />
            <Button
              label="ابعت للجروب"
              icon="share-social"
              variant="whatsapp"
              style={{ flex: 1 }}
              onPress={() => Share.share({ message: groupSummaryMessage(circle, entry, [...s.unpaid, ...s.claimed]) }).catch(() => {})}
            />
          </Row>
        </>
      )}
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
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (!started) buttons.push({ text: `أجّل الفترة دي ${unit}`, onPress: () => doPostpone(e.index) });
    if (e.index > 0 && !started)
      buttons.push({ text: 'طلّعها لفوق', onPress: () => run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index - 1))) });
    if (e.index < entries.length - 1 && !started)
      buttons.push({ text: 'نزّلها لتحت', onPress: () => run(() => mutatePeriods(circle.id, (ps) => movePeriod(ps, e.index, e.index + 1))) });
    if (e.period.kind !== 'payout' || !hasPayments(e.period.id)) {
      if (e.period.kind !== 'payout' || circle.periods.filter((p) => p.recipientId === e.period.recipientId).length > 1) {
        buttons.push({
          text: 'احذف الفترة',
          style: 'destructive',
          onPress: () => run(() => mutatePeriods(circle.id, (ps) => removePeriod(ps, e.period.id))),
        });
      }
    }
    if (buttons.length === 0) return Alert.alert('الفترة دي بدأت', 'مينفعش تتعدّل بعد ما ميعادها جه.');
    Alert.alert(periodTitle(e), formatDate(e.date), [...buttons, { text: 'إلغاء', style: 'cancel' }]);
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
            label="قرعة"
            icon="shuffle"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={anyPayout || current >= 0}
            onPress={async () => {
              if (await confirm('قرعة جديدة؟', 'ترتيب القبض هيتغير عشوائيًا لكل الأعضاء.', 'اعمل القرعة')) {
                run(() => mutatePeriods(circle.id, (ps) => drawTurns(ps)));
              }
            }}
          />
        </Row>
        <Text variant="caption">دوس على أي فترة لتأجيلها، أو تحريكها، أو حذفها.</Text>
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
  const joined = circle.members.filter((m) => m.uid).length;

  const invite = (m: Member) =>
    RNLinking.openURL(whatsappUrl(m.phone, inviteMessage(circle, m, link))).catch(() =>
      Alert.alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.'),
    );

  const unlink = async (m: Member) => {
    if (await confirm('فك ربط الموبايل؟', `${m.name} هيخرج من التطبيق، ويقدر يدخل تاني بالكود ورقمه (مثلًا لو غيّر موبايله).`, 'فك الربط', true)) {
      run(() => unlinkMember(circle, m));
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ alignItems: 'center' }}>
        <Text variant="caption">كود الجمعية</Text>
        <Pressable
          onPress={() => {
            Clipboard.setStringAsync(circle.inviteCode).catch(() => {});
            Alert.alert('اتنسخ ✓', 'الكود اتنسخ.');
          }}
        >
          <Text variant="number" style={{ letterSpacing: 6 }}>
            {circle.inviteCode}
          </Text>
        </Pressable>
        <Text variant="caption" center>
          كل عضو يدخل بالكود ده + رقم موبايله المسجل. دخل لحد دلوقتي {formatNumber(joined)} من {formatNumber(circle.members.length)}.
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
        {circle.members.map((m, k) => (
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
        ))}
      </Card>
    </View>
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
  num: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
