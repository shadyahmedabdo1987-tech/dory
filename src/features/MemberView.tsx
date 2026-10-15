import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
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
  METHOD_LABEL,
  methodOf,
  todayISO,
  paymentId,
  type AccountLine,
  type Circle,
  type MemberPaymentState,
  type Payment,
  type TimelineEntry,
} from '@/core';
import { removePayment } from '@/data';
import { Badge, Button, Card, ProgressBar, Row, Text } from '@/ui/components';
import { confirm, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

import { PaySheet } from './PaySheet';
import { ReceiptViewer } from './ReceiptViewer';

const STATE_BADGE: Record<MemberPaymentState, { label: string; tone: 'success' | 'gold' | 'danger' | 'neutral' } | null> = {
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

  const claim = (line: AccountLine) => setPaying(line.entry);

  const undo = async (line: AccountLine) => {
    if (await confirm('تراجع؟', 'هنشيل البلاغ بتاعك إنك دفعت القسط ده.', 'تراجع', true)) {
      if (line.payment) run(() => removePayment(circle.id, line.payment!));
    }
  };

  const next = acc.nextDue;
  const paidRatio = acc.totalCommitment ? acc.totalPaid / acc.totalCommitment : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      {/* Balance card */}
      <View style={styles.balance}>
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
      </View>

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
        {acc.myPayouts.map((p) => (
          <Row key={p.entry.period.id} style={styles.payout}>
            <View style={{ flex: 1 }}>
              <Text weight="bold">{formatMoney(p.amount)}</Text>
              <Text variant="caption">
                {formatDate(p.entry.date)}
                {!p.received ? ` • ${relativeDays(daysBetween(today, p.entry.date))}` : ''}
              </Text>
            </View>
            <Badge label={p.received ? 'استلمت ✓' : `الدور رقم ${formatNumber(p.entry.index + 1)}`} tone={p.received ? 'success' : 'gold'} />
          </Row>
        ))}
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
                  {line.payment ? ` • ${METHOD_LABEL[methodOf(line.payment)]}` : ''}
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
      <ReceiptViewer
        circleId={circle.id}
        paymentId={viewing ? paymentId(viewing.entry.period.id, memberId) : null}
        title="صورة التحويل"
        subtitle={viewing ? `${formatMoney(viewing.entry.due)} • ${formatDate(viewing.entry.date)}` : undefined}
        onClose={() => setViewing(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  balance: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, gap: space.xs },
  alert: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, gap: space.sm },
  payout: { backgroundColor: colors.goldSoft, borderRadius: radius.sm, padding: space.md, gap: space.md },
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
