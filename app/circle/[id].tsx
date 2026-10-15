import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildSchedule,
  formatDate,
  formatMoney,
  formatNumber,
  groupSummaryMessage,
  memberStatement,
  ordinalTurn,
  potSize,
  progress,
  reminderMessage,
  summarizeCycle,
  todayISO,
  whatsappUrl,
  type Circle,
  type Member,
} from '@/core';
import { useCircle, useCircles } from '@/store/circles';
import { Badge, Button, Card, EmptyState, IconButton, ProgressBar, Row, Segmented, Text, tap } from '@/ui/components';
import { colors, radius, space } from '@/ui/theme';

type Tab = 'cycle' | 'schedule' | 'members';

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const insets = useSafeAreaInsets();
  const today = todayISO();
  const p = circle ? progress(circle, today) : null;
  const [selected, setSelected] = useState(() => Math.max(0, p?.currentCycle ?? 0));
  const [tab, setTab] = useState<Tab>('cycle');

  if (!circle || !p) {
    return <EmptyState icon="alert-circle-outline" title="الجمعية مش موجودة" body="ممكن تكون اتمسحت." />;
  }

  const cycle = Math.min(selected, circle.members.length - 1);

  return (
    <>
      <Stack.Screen
        options={{
          title: circle.name,
          headerRight: () => <HeaderActions circle={circle} />,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
        <Overview circle={circle} today={today} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'cycle', label: 'التحصيل' },
            { value: 'schedule', label: 'الأدوار' },
            { value: 'members', label: 'الأعضاء' },
          ]}
        />
        {tab === 'cycle' && (
          <CycleView circle={circle} cycle={cycle} current={p.currentCycle} onSelect={setSelected} />
        )}
        {tab === 'schedule' && (
          <ScheduleView
            circle={circle}
            current={p.currentCycle}
            onOpen={(c) => {
              setSelected(c);
              setTab('cycle');
            }}
          />
        )}
        {tab === 'members' && <MembersView circle={circle} today={today} />}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------

function HeaderActions({ circle }: { circle: Circle }) {
  const deleteCircle = useCircles((s) => s.deleteCircle);
  const confirmDelete = () =>
    Alert.alert('مسح الجمعية؟', `هيتم مسح "${circle.name}" وكل المدفوعات. مش هتقدر ترجّعها.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسح',
        style: 'destructive',
        onPress: () => {
          router.back();
          deleteCircle(circle.id);
        },
      },
    ]);
  return (
    <Row gap={space.md}>
      <Pressable
        accessibilityLabel="تعديل"
        hitSlop={10}
        onPress={() => router.push({ pathname: '/circle/edit/[id]', params: { id: circle.id } })}
      >
        <Ionicons name="create-outline" size={22} color={colors.white} />
      </Pressable>
      <Pressable accessibilityLabel="مسح" hitSlop={10} onPress={confirmDelete}>
        <Ionicons name="trash-outline" size={22} color={colors.white} />
      </Pressable>
    </Row>
  );
}

function Overview({ circle, today }: { circle: Circle; today: string }) {
  const p = progress(circle, today);
  return (
    <View style={styles.overview}>
      <Text variant="caption" color="rgba(255,255,255,0.75)">
        القبض في كل دور
      </Text>
      <Text variant="number" color={colors.gold}>
        {formatMoney(potSize(circle), circle.currency)}
      </Text>
      <Text variant="caption" color="rgba(255,255,255,0.85)">
        {formatNumber(circle.members.length)} عضو × {formatMoney(circle.installment, circle.currency)}{' '}
        {circle.frequency === 'monthly' ? 'شهريًا' : 'أسبوعيًا'}
      </Text>
      <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.sm }}>
        <ProgressBar value={p.ratio} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="caption" color={colors.white}>
            قبض {formatNumber(p.paidOut)} من {formatNumber(p.totalCycles)}
          </Text>
          {p.overdueAmount > 0 ? (
            <Text variant="caption" weight="bold" color="#FFD6A5">
              متأخرات {formatMoney(p.overdueAmount, circle.currency)}
            </Text>
          ) : (
            <Text variant="caption" color={colors.white}>
              مفيش متأخرات ✓
            </Text>
          )}
        </Row>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

function CycleView({
  circle,
  cycle,
  current,
  onSelect,
}: {
  circle: Circle;
  cycle: number;
  current: number;
  onSelect: (c: number) => void;
}) {
  const store = useCircles();
  const summary = summarizeCycle(circle, cycle);
  const ratio = summary.collected / summary.pot;

  const remind = (member: Member) =>
    Linking.openURL(whatsappUrl(member.phone, reminderMessage(circle, member, cycle, summary.date))).catch(() =>
      Alert.alert('واتساب مش متاح', 'اتأكد إن واتساب متسطّب على الموبايل.'),
    );

  const shareSummary = () =>
    Share.share({
      message: groupSummaryMessage(circle, cycle, summary.date, summary.recipient, summary.unpaidMembers),
    }).catch(() => {});

  return (
    <View style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton
          icon="chevron-forward"
          label="الدور اللي فات"
          disabled={cycle === 0}
          onPress={() => onSelect(cycle - 1)}
        />
        <View style={{ alignItems: 'center' }}>
          <Text variant="heading">الدور {ordinalTurn(cycle)}</Text>
          <Text variant="caption">
            {formatDate(summary.date)}
            {cycle === current ? ' • الحالي' : ''}
          </Text>
        </View>
        <IconButton
          icon="chevron-back"
          label="الدور اللي جاي"
          disabled={cycle === circle.members.length - 1}
          onPress={() => onSelect(cycle + 1)}
        />
      </Row>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm} style={{ flex: 1 }}>
            <View style={styles.avatarGold}>
              <Ionicons name="gift" size={20} color="#8A6A1C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="caption">بيقبض الدور ده</Text>
              <Text weight="bold" numberOfLines={1}>
                {summary.recipient.name}
              </Text>
            </View>
          </Row>
          <Badge
            label={summary.isPaidOut ? 'استلم ✓' : 'لسه ما استلمش'}
            tone={summary.isPaidOut ? 'success' : 'gold'}
          />
        </Row>
        <View style={{ gap: space.xs }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="caption">
              اتجمع {formatMoney(summary.collected, circle.currency)} من {formatMoney(summary.pot, circle.currency)}
            </Text>
            <Text variant="caption" weight="bold">
              {formatNumber(summary.paidMembers.length)}/{formatNumber(circle.members.length)}
            </Text>
          </Row>
          <ProgressBar value={ratio} color={summary.isComplete ? colors.success : colors.gold} />
        </View>
        <Button
          label={summary.isPaidOut ? 'إلغاء تسليم القبض' : 'سلّمت القبض'}
          icon={summary.isPaidOut ? 'arrow-undo-outline' : 'cash-outline'}
          variant={summary.isPaidOut ? 'secondary' : 'primary'}
          onPress={() => {
            if (!summary.isPaidOut && !summary.isComplete) {
              Alert.alert('لسه في ناس ما دفعتش', 'متأكد إنك سلّمت القبض؟', [
                { text: 'لأ', style: 'cancel' },
                { text: 'أيوه', onPress: () => store.togglePaidOut(circle.id, cycle) },
              ]);
            } else store.togglePaidOut(circle.id, cycle);
          }}
        />
      </Card>

      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        {circle.members.map((m, i) => {
          const paid = !summary.unpaidMembers.includes(m);
          return (
            <View key={m.id} style={[styles.memberRow, i > 0 && styles.divider]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: paid }}
                accessibilityLabel={`${m.name} ${paid ? 'دفع' : 'ما دفعش'}`}
                onPress={() => {
                  tap();
                  store.togglePayment(circle.id, m.id, cycle);
                }}
                style={[styles.check, paid && styles.checkOn]}
              >
                {paid && <Ionicons name="checkmark" size={20} color={colors.white} />}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text weight="semibold" numberOfLines={1}>
                  {m.name}
                </Text>
                <Text variant="caption" color={paid ? colors.success : colors.muted}>
                  {paid ? 'دفع' : 'لسه'}
                </Text>
              </View>
              {!paid && (
                <IconButton
                  icon="logo-whatsapp"
                  label={`ذكّر ${m.name}`}
                  color={colors.white}
                  bg={colors.whatsapp}
                  onPress={() => remind(m)}
                />
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
          disabled={summary.isComplete}
          onPress={() => store.markAllPaid(circle.id, cycle)}
        />
        <Button label="ابعت للجروب" icon="share-social" variant="whatsapp" style={{ flex: 1 }} onPress={shareSummary} />
      </Row>
    </View>
  );
}

// ---------------------------------------------------------------------------

function ScheduleView({ circle, current, onOpen }: { circle: Circle; current: number; onOpen: (c: number) => void }) {
  const schedule = useMemo(() => buildSchedule(circle), [circle]);
  return (
    <Card style={{ gap: 0, paddingVertical: space.sm }}>
      {schedule.map((entry, i) => {
        const s = summarizeCycle(circle, entry.cycle);
        const isCurrent = entry.cycle === current;
        return (
          <Pressable
            key={entry.cycle}
            onPress={() => onOpen(entry.cycle)}
            style={({ pressed }) => [styles.memberRow, i > 0 && styles.divider, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.turnNum, isCurrent && { backgroundColor: colors.gold }]}>
              <Text weight="bold" color={isCurrent ? colors.white : colors.primary}>
                {formatNumber(entry.cycle + 1)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="semibold" numberOfLines={1}>
                {entry.recipient.name}
              </Text>
              <Text variant="caption">{formatDate(entry.date)}</Text>
            </View>
            {s.isPaidOut ? (
              <Badge label="استلم" tone="success" />
            ) : isCurrent ? (
              <Badge label="الحالي" tone="gold" />
            ) : entry.cycle < current ? (
              <Badge label="متأخر" tone="danger" />
            ) : null}
          </Pressable>
        );
      })}
    </Card>
  );
}

function MembersView({ circle, today }: { circle: Circle; today: string }) {
  return (
    <View style={{ gap: space.md }}>
      {circle.members.map((m) => {
        const s = memberStatement(circle, m.id, today);
        return (
          <Card key={m.id} style={{ gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text weight="bold" style={{ flex: 1 }} numberOfLines={1}>
                {m.name}
              </Text>
              {s.overdue.length > 0 ? (
                <Badge label={`متأخر ${formatNumber(s.overdue.length)}`} tone="danger" />
              ) : (
                <Badge label="منتظم" tone="success" />
              )}
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Mini label="دوره" value={ordinalTurn(s.turn)} />
              <Mini label="يقبض في" value={formatDate(s.payoutDate, false)} />
              <Mini label="دفع لحد دلوقتي" value={formatMoney(s.totalPaid, circle.currency)} />
            </Row>
            {m.phone ? (
              <Row gap={space.xs}>
                <Ionicons name="call-outline" size={14} color={colors.muted} />
                <Text variant="caption">{m.phone}</Text>
              </Row>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text variant="caption">{label}</Text>
      <Text weight="semibold">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overview: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: 2,
  },
  avatarGold: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
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
  turnNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
