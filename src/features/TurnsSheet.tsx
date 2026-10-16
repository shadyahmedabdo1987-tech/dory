import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  currentIndex,
  daysBetween,
  findPayment,
  formatDate,
  formatMoney,
  formatNumber,
  payoutNet,
  paymentState,
  periodSummary,
  periodTitle,
  relativeDays,
  timeline,
  todayISO,
  type Circle,
  type Payment,
  type TimelineEntry,
} from '@/core';
import { Badge, Row, Segmented, Text } from '@/ui/components';
import { Sheet } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

type Tone = 'neutral' | 'success' | 'danger' | 'gold';
type Filter = 'left' | 'all';

/**
 * Every turn of the circle with its date and whether it was paid: for the
 * admin how much of each turn was collected; for a member their own
 * installment. Both see whether the turn's money was handed over.
 */
export function TurnsSheet({
  visible,
  onClose,
  circle,
  payments,
  memberId,
}: {
  visible: boolean;
  onClose: () => void;
  circle: Circle;
  payments: Payment[];
  /** Set for a member: shows their own installment per turn. */
  memberId?: string;
}) {
  const [filter, setFilter] = useState<Filter>('left');
  if (!visible) return null;

  const today = todayISO();
  const current = currentIndex(circle, today);
  const entries = timeline(circle);
  const done = (e: TimelineEntry) => (e.period.kind === 'payout' ? !!e.period.paidOut : e.index < current);
  const left = entries.filter((e) => !done(e));
  const shown = filter === 'left' ? left : entries;
  let turnNo = 0;
  const numbers = new Map(entries.map((e) => [e.index, e.period.kind === 'payout' ? ++turnNo : 0]));

  return (
    <Sheet visible title="الأدوار" onClose={onClose}>
      <View style={{ gap: space.md }}>
        <Row style={styles.summary}>
          <Summary label="كل الأدوار" value={formatNumber(turnNo)} />
          <Summary label="اتقبض" value={formatNumber(entries.filter((e) => e.period.kind === 'payout' && e.period.paidOut).length)} tone={colors.success} />
          <Summary label="باقي" value={formatNumber(left.filter((e) => e.period.kind === 'payout').length)} tone={colors.primary} />
        </Row>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'left', label: `الباقية (${formatNumber(left.length)})` },
            { value: 'all', label: 'كل الأدوار' },
          ]}
        />
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
          {shown.length === 0 ? (
            <Text center variant="caption">
              كل الأدوار خلصت ✓
            </Text>
          ) : (
            shown.map((e) => (
              <TurnRow
                key={e.period.id}
                entry={e}
                number={numbers.get(e.index) ?? 0}
                circle={circle}
                payments={payments}
                current={current}
                today={today}
                memberId={memberId}
              />
            ))
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text weight="bold" color={tone ?? colors.text} style={{ fontSize: 18 }}>
        {value}
      </Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

const MEMBER_STATE: Record<string, { label: string; tone: Tone }> = {
  covered: { label: 'دورك — محسوب مدفوع', tone: 'success' },
  confirmed: { label: 'قسطك اتسدد ✓', tone: 'success' },
  claimed: { label: 'قسطك مستني التأكيد', tone: 'gold' },
  overdue: { label: 'قسطك متأخر', tone: 'danger' },
  due: { label: 'قسطك مستحق دلوقتي', tone: 'gold' },
  upcoming: { label: 'لسه ما جاش', tone: 'neutral' },
};

function TurnRow({
  entry,
  number,
  circle,
  payments,
  current,
  today,
  memberId,
}: {
  entry: TimelineEntry;
  number: number;
  circle: Circle;
  payments: Payment[];
  current: number;
  today: string;
  memberId?: string;
}) {
  const isPayout = entry.period.kind === 'payout';
  const isCurrent = entry.index === current;
  const future = entry.index > current;
  const mine = !!memberId && isPayout && entry.period.recipientId === memberId;

  // Was this turn's money paid in?
  let payBadge: { label: string; tone: Tone } | null = null;
  if (entry.due > 0) {
    if (memberId) {
      const st = paymentState(entry, findPayment(payments, entry.period.id, memberId), current, today, memberId);
      payBadge = MEMBER_STATE[st] ?? null;
    } else if (!future) {
      const s = periodSummary(circle, payments, entry.index);
      const n = s.payers.length;
      const c = s.confirmed.length;
      payBadge =
        n === 0 || c === n
          ? { label: 'اتسدد كله ✓', tone: 'success' }
          : { label: `اتسدد ${formatNumber(c)} من ${formatNumber(n)}`, tone: isCurrent ? 'gold' : 'danger' };
    } else {
      payBadge = { label: 'لسه ما جاش', tone: 'neutral' };
    }
  }

  // Was the turn handed over?
  const payoutBadge: { label: string; tone: Tone } | null = isPayout
    ? entry.period.paidOut
      ? { label: 'اتقبض ✓', tone: 'success' }
      : future
        ? null
        : { label: 'لسه ما اتقبضش', tone: 'gold' }
    : null;

  const days = daysBetween(today, entry.date);
  const icon = !isPayout ? (entry.period.kind === 'skip' ? 'pause-circle' : 'add-circle') : entry.period.paidOut ? 'checkmark-circle' : 'gift';

  return (
    <View style={[styles.row, isCurrent && styles.rowCurrent, mine && styles.rowMine]}>
      <Row gap={space.sm}>
        <View style={[styles.num, entry.period.paidOut && { backgroundColor: colors.successSoft }]}>
          {number ? (
            <Text weight="bold" color={entry.period.paidOut ? colors.success : colors.primary}>
              {formatNumber(number)}
            </Text>
          ) : (
            <Ionicons name={icon} size={18} color={colors.muted} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" numberOfLines={1}>
            {periodTitle(entry)}
            {mine ? ' (دورك)' : ''}
          </Text>
          <Text variant="caption">
            {formatDate(entry.date)}
            {future || isCurrent ? ` • ${isCurrent ? 'الحالي' : relativeDays(days)}` : ''}
          </Text>
        </View>
        {isPayout ? (
          <Text weight="bold" color={colors.primary}>
            {formatMoney(payoutNet(circle))}
          </Text>
        ) : null}
      </Row>
      {payBadge || payoutBadge ? (
        <Row gap={space.xs} style={{ flexWrap: 'wrap', marginTop: space.xs }}>
          {payBadge ? <Badge label={payBadge.label} tone={payBadge.tone} /> : null}
          {payoutBadge ? <Badge label={payoutBadge.label} tone={payoutBadge.tone} /> : null}
        </Row>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: colors.white,
  },
  rowCurrent: { borderColor: colors.primary, borderWidth: 2 },
  rowMine: { backgroundColor: colors.goldSoft },
  num: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
