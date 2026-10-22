import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDate, formatNumber, periodSummary, type Circle, type Payment } from '@/core';
import { Text, tap } from '@/ui/components';
import { colors, radius, space } from '@/ui/theme';

export type TurnState = 'done' | 'collected' | 'open' | 'upcoming' | 'skip';

/** Where one turn stands: green once its money is all in (and handed over), yellow until then. */
export function turnState(circle: Circle, payments: Payment[], index: number, current: number): { state: TurnState; paid: number; total: number } {
  const s = periodSummary(circle, payments, index);
  const kind = s.entry.period.kind;
  if (kind === 'skip') return { state: 'skip', paid: 0, total: 0 };
  const total = s.payers.length;
  const paid = s.confirmed.length;
  if (s.isComplete && (kind !== 'payout' || s.entry.period.paidOut)) return { state: 'done', paid, total };
  if (s.isComplete) return { state: 'collected', paid, total };
  return { state: index > current && paid === 0 ? 'upcoming' : 'open', paid, total };
}

const LABEL: Record<TurnState, string> = {
  done: 'تم الانتهاء من الدور',
  collected: 'تم السداد',
  open: 'لسه ما اتسددش',
  upcoming: 'جاي',
  skip: 'مؤجّل',
};

/**
 * Every turn as a tile (one per recipient, however many members): yellow while it's being
 * paid, green with ✓ once it's paid in full. Tapping a tile shows that turn's payments.
 */
export function TurnGrid({
  circle,
  payments,
  current,
  selected,
  onSelect,
  details,
}: {
  circle: Circle;
  payments: Payment[];
  current: number;
  selected: number;
  onSelect: (index: number) => void;
  /** The chosen turn's payments, shown right under its row. */
  details?: ReactNode;
}) {
  const items = useMemo(() => {
    const n = circle.periods.length;
    return Array.from({ length: n }, (_, i) => {
      const s = periodSummary(circle, payments, i);
      const t = turnState(circle, payments, i, current);
      const name = s.entry.period.kind === 'payout' ? s.entry.recipient?.name ?? '—' : s.entry.period.kind === 'skip' ? 'تأجيل' : 'قسط إضافي';
      return { i, name, date: s.entry.date, ...t };
    });
  }, [circle, payments, current]);

  const doneCount = items.filter((x) => x.state === 'done').length;
  const rows: (typeof items)[] = [];
  for (let k = 0; k < items.length; k += 3) rows.push(items.slice(k, k + 3));

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Text variant="heading">الأدوار</Text>
        <Text variant="caption" weight="semibold" color={colors.success}>
          خلص {formatNumber(doneCount)} من {formatNumber(items.length)}
        </Text>
      </View>
      {rows.map((row, r) => (
        <View key={r} style={{ gap: space.sm }}>
      <View style={styles.grid}>
        {row.map((x) => {
          const green = x.state === 'done' || x.state === 'collected';
          const grey = x.state === 'skip';
          const bg = green ? colors.success : grey ? colors.border : x.state === 'upcoming' ? colors.goldSoft : colors.gold;
          const fg = green || x.state === 'open' ? colors.white : colors.goldText;
          const on = x.i === selected;
          return (
            <Pressable
              key={x.i}
              accessibilityRole="button"
              accessibilityLabel={`${x.name}: ${LABEL[x.state]}`}
              onPress={() => {
                tap();
                onSelect(x.i);
              }}
              style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.8 }]}
            >
              <View style={[styles.badge, { backgroundColor: bg }]}>
                {green ? (
                  <Ionicons name="checkmark" size={26} color={colors.white} />
                ) : grey ? (
                  <Ionicons name="pause" size={22} color={colors.muted} />
                ) : (
                  <Text weight="bold" color={fg} style={{ fontSize: 18, lineHeight: 26 }}>
                    {formatNumber(x.i + 1)}
                  </Text>
                )}
              </View>
              <Text weight="bold" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ alignSelf: 'stretch' }}>
                {x.name}
              </Text>
              <Text variant="caption" center numberOfLines={1}>
                {formatDate(x.date, false)}
              </Text>
              <Text
                variant="caption"
                center
                weight="semibold"
                numberOfLines={2}
                color={green ? colors.success : grey ? colors.muted : colors.goldText}
                style={{ fontSize: 11, lineHeight: 16 }}
              >
                {x.state === 'open' && x.total ? `${formatNumber(x.paid)}/${formatNumber(x.total)} دفعوا` : LABEL[x.state]}
              </Text>
              {x.i === current && x.state !== 'done' ? <View style={styles.nowDot} /> : null}
              <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={16} color={on ? colors.primary : colors.muted} style={styles.chev} />
            </Pressable>
          );
        })}
      </View>
          {row.some((x) => x.i === selected) ? details : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '31.5%',
    flexGrow: 0,
    alignItems: 'center',
    gap: 2,
    paddingVertical: space.sm,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tileOn: { borderColor: colors.primary, borderWidth: 2.5, backgroundColor: colors.primarySoft },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  chev: { position: 'absolute', top: 6, right: 6 },
  nowDot: { position: 'absolute', top: 6, left: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
});
