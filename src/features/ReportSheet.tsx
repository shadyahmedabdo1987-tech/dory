import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import {
  circleReport,
  formatDate,
  formatMoney,
  formatNumber,
  memberReport,
  METHOD_LABEL,
  type Circle,
  type MemberReport,
  type Payment,
} from '@/core';
import { Badge, Button, Card, ProgressBar, Row, Text } from '@/ui/components';
import { Sheet } from '@/ui/feedback';
import { Reveal, ScrollToContext, useScrollTo } from '@/ui/Reveal';
import { colors, radius, space } from '@/ui/theme';

/**
 * Statement of the circle: for a member their own turn and installments; for
 * the admin one row per member plus totals. Shareable as text.
 */
export function ReportSheet({
  visible,
  onClose,
  circle,
  payments,
  role,
  memberId,
}: {
  visible: boolean;
  onClose: () => void;
  circle: Circle;
  payments: Payment[];
  role: 'admin' | 'member';
  memberId?: string;
}) {
  const scroll = useScrollTo();
  if (!visible) return null;
  return (
    <Sheet visible title={role === 'admin' ? `تقرير "${circle.name}"` : 'تقريري'} onClose={onClose}>
      <ScrollToContext.Provider value={scroll.scrollToNode}>
      <ScrollView ref={scroll.scrollRef} contentContainerStyle={{ paddingBottom: space.lg }}>
      <View ref={scroll.contentRef} collapsable={false} style={{ gap: space.md }}>
        {role === 'admin' ? (
          <AdminReport circle={circle} payments={payments} />
        ) : memberId ? (
          <MemberReportView report={memberReport(circle, payments, memberId)} circle={circle} share />
        ) : null}
      </View>
      </ScrollView>
      </ScrollToContext.Provider>
    </Sheet>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" weight="semibold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
      <Text
        weight="bold"
        color={tone ?? colors.text}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{ fontSize: 18, lineHeight: 28 }}
      >
        {value}
      </Text>
      <Text variant="caption" numberOfLines={1} style={{ fontSize: 11, lineHeight: 16, opacity: sub ? 1 : 0 }}>
        {sub ?? '—'}
      </Text>
    </View>
  );
}

function turnText(r: MemberReport) {
  if (!r.turns.length) return 'مالوش دور في الجدول لسه';
  return r.turns
    .map((t) => `الدور رقم ${formatNumber(t.number)} • ${formatDate(t.date)} • ${formatMoney(t.amount)}${t.received ? ' (قبض ✓)' : ''}`)
    .join('\n');
}

function memberText(circle: Circle, r: MemberReport) {
  return [
    `📊 تقرير ${r.member.name} — جمعية "${circle.name}"`,
    `🎁 ${turnText(r)}`,
    `✅ دفع ${formatNumber(r.installmentsPaid)} من ${formatNumber(r.installmentsTotal)} قسط: ${formatMoney(r.amountPaid)}`,
    `⏳ باقي ${formatNumber(r.installmentsLeft)} قسط: ${formatMoney(r.amountLeft)}`,
    ...(r.installmentsOverdue ? [`⚠️ متأخر ${formatNumber(r.installmentsOverdue)} قسط: ${formatMoney(r.amountOverdue)}`] : []),
  ].join('\n');
}

function MemberReportView({ report: r, circle, share }: { report: MemberReport; circle: Circle; share?: boolean }) {
  const ratio = r.installmentsTotal ? r.installmentsPaid / r.installmentsTotal : 0;
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <Row gap={space.sm}>
          <Ionicons name="gift" size={22} color={colors.gold} />
          <Text variant="heading" style={{ flex: 1 }}>
            دورك في القبض
          </Text>
        </Row>
        {r.turns.length ? (
          r.turns.map((t) => (
            <Row key={t.number} gap={space.sm} style={styles.turn}>
              <View style={styles.turnNum}>
                <Text weight="bold" color={colors.primary}>
                  {formatNumber(t.number)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{formatDate(t.date)}</Text>
                <Text variant="caption">{formatMoney(t.amount)}</Text>
              </View>
              <Badge label={t.received ? 'قبض ✓' : 'لسه'} tone={t.received ? 'success' : 'gold'} />
            </Row>
          ))
        ) : (
          <Text variant="caption">مالوش دور في الجدول لسه.</Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">الأقساط</Text>
        <ProgressBar value={ratio} color={colors.success} />
        <Text variant="caption">
          دفع {formatNumber(r.installmentsPaid)} من {formatNumber(r.installmentsTotal)} قسط
        </Text>
        <View style={styles.stats}>
          <Stat label="اتدفع" value={formatMoney(r.amountPaid)} tone={colors.success} sub={`${formatNumber(r.installmentsPaid)} قسط`} />
          <Stat label="باقي" value={formatMoney(r.amountLeft)} sub={`${formatNumber(r.installmentsLeft)} قسط`} />
          <Stat
            label="متأخر"
            sub={`${formatNumber(r.installmentsOverdue)} قسط`}
            value={formatMoney(r.amountOverdue)}
            tone={r.amountOverdue ? colors.danger : colors.muted}
          />
        </View>
        {r.installmentsPending ? (
          <Text variant="caption" color={colors.goldText}>
            {formatNumber(r.installmentsPending)} قسط مستني تأكيد صاحب الجمعية.
          </Text>
        ) : null}
      </Card>

      {r.paid.length ? (
        <Card style={{ gap: 0, paddingVertical: space.sm }}>
          <Text variant="heading" style={{ paddingVertical: space.sm }}>
            اللي اتسدد
          </Text>
          {r.paid.map((p, i) => (
            <Row key={`${p.date}-${i}`} gap={space.sm} style={styles.line}>
              <Ionicons name={p.how === 'covered' ? 'gift-outline' : 'checkmark-circle'} size={18} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{formatDate(p.date)}</Text>
                <Text variant="caption" numberOfLines={1}>
                  {p.how === 'covered' ? 'دوره في القبض — محسوب مدفوع' : p.method ? METHOD_LABEL[p.method] : 'مدفوع'}
                </Text>
              </View>
              <Text weight="bold" numberOfLines={1}>{formatMoney(p.amount)}</Text>
            </Row>
          ))}
        </Card>
      ) : null}

      {share ? (
        <Button
          label="شارك التقرير"
          icon="share-outline"
          variant="secondary"
          onPress={() => Share.share({ message: memberText(circle, r) }).catch(() => {})}
        />
      ) : null}
    </View>
  );
}

function AdminReport({ circle, payments }: { circle: Circle; payments: Payment[] }) {
  const rep = circleReport(circle, payments);
  const [open, setOpen] = useState<string | null>(null);

  const text = [
    `📊 تقرير جمعية "${circle.name}"`,
    `اتجمع ${formatMoney(rep.collected)} • باقي ${formatMoney(rep.outstanding)}${rep.overdue ? ` • متأخر ${formatMoney(rep.overdue)}` : ''}`,
    `القبض: ${formatNumber(rep.payoutsDone)} من ${formatNumber(rep.payoutsTotal)}`,
    '',
    ...rep.rows.map(
      (r) =>
        `• ${r.member.name}: الدور ${r.turns.map((t) => formatNumber(t.number)).join('، ') || '—'} • دفع ${formatNumber(r.installmentsPaid)}/${formatNumber(r.installmentsTotal)} • باقي ${formatMoney(r.amountLeft)}${r.installmentsOverdue ? ` • متأخر ${formatNumber(r.installmentsOverdue)}` : ''}`,
    ),
  ].join('\n');

  return (
    <View style={{ gap: space.md }}>
      <Card>
        <View style={styles.stats}>
          <Stat label="اتجمع" value={formatMoney(rep.collected)} tone={colors.success} />
          <Stat label="باقي على الأعضاء" value={formatMoney(rep.outstanding)} />
          <Stat label="متأخرات" value={formatMoney(rep.overdue)} tone={rep.overdue ? colors.danger : colors.muted} />
        </View>
        <Text variant="caption">
          القبض: اتسلّم {formatNumber(rep.payoutsDone)} من {formatNumber(rep.payoutsTotal)} دور
        </Text>
        <ProgressBar value={rep.payoutsTotal ? rep.payoutsDone / rep.payoutsTotal : 0} />
      </Card>

      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        <Text variant="heading" style={{ paddingVertical: space.sm }}>
          الأعضاء
        </Text>
        {rep.rows.map((r, k) => {
          const expanded = open === r.member.id;
          return (
            <Reveal key={r.member.id} active={expanded} style={k > 0 ? styles.divider : undefined}>
              <Pressable onPress={() => setOpen(expanded ? null : r.member.id)} style={styles.row}>
                <View style={styles.turnNum}>
                  <Text weight="bold" color={colors.primary}>
                    {r.turns[0] ? formatNumber(r.turns[0].number) : '—'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text weight="semibold" numberOfLines={1}>
                    {r.member.name}
                    {r.member.id === circle.ownerMemberId ? ' (إنت)' : ''}
                  </Text>
                  <Text variant="caption">
                    دفع {formatNumber(r.installmentsPaid)}/{formatNumber(r.installmentsTotal)} • باقي {formatMoney(r.amountLeft)}
                  </Text>
                </View>
                {r.installmentsOverdue ? <Badge label={`متأخر ${formatNumber(r.installmentsOverdue)}`} tone="danger" /> : null}
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {expanded ? (
                <View style={{ paddingBottom: space.md }}>
                  <MemberReportView report={r} circle={circle} />
                </View>
              ) : null}
            </Reveal>
          );
        })}
      </Card>

      <Button label="شارك التقرير" icon="share-outline" variant="secondary" onPress={() => Share.share({ message: text }).catch(() => {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    gap: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  turn: { paddingVertical: space.xs },
  turnNum: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
