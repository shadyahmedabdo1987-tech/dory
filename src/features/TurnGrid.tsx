import { Ionicons } from '@expo/vector-icons';
import { useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDate, formatNumber, periodSummary, type Circle, type Payment } from '@/core';
import { Text, tap } from '@/ui/components';
import { ScrollToContext } from '@/ui/Reveal';
import { colors, radius, space } from '@/ui/theme';

export type TurnState = 'done' | 'awaiting' | 'collected' | 'open' | 'upcoming' | 'skip';

/** Where one turn stands: green once its money is all in (and handed over), yellow until then. */
export function turnState(circle: Circle, payments: Payment[], index: number, current: number): { state: TurnState; paid: number; total: number } {
  const s = periodSummary(circle, payments, index);
  const kind = s.entry.period.kind;
  if (kind === 'skip') return { state: 'skip', paid: 0, total: 0 };
  const total = s.payers.length;
  const paid = s.confirmed.length;
  if (kind !== 'payout') return s.isComplete ? { state: 'done', paid, total } : { state: index > current && paid === 0 ? 'upcoming' : 'open', paid, total };
  // A turn is over only when its recipient confirmed getting the money (the organizer's own turn needs no confirmation).
  const own = !!circle.ownerMemberId && s.entry.period.recipientId === circle.ownerMemberId;
  if (s.entry.period.paidOut && (own || s.entry.period.received)) return { state: 'done', paid, total };
  if (s.entry.period.paidOut) return { state: 'awaiting', paid, total };
  if (s.isComplete) return { state: 'collected', paid, total };
  return { state: index > current && paid === 0 ? 'upcoming' : 'open', paid, total };
}

const LABEL: Record<TurnState, string> = {
  done: 'تم الانتهاء من الدور',
  awaiting: 'اتسلّم • مستني تأكيد الاستلام',
  collected: 'تم السداد • مستني التسليم',
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

  // Opening a turn brings its row + details into view; closing it goes back up to the tile.
  const scrollTo = useContext(ScrollToContext);
  const rowRefs = useRef<(View | null)[]>([]);
  const last = useRef(-1);
  useEffect(() => {
    const k = selected >= 0 ? selected : last.current;
    if (selected >= 0) last.current = selected;
    if (k < 0 || !scrollTo) return;
    const t = setTimeout(() => scrollTo(rowRefs.current[Math.floor(k / 3)] ?? null), selected >= 0 ? 80 : 30);
    return () => clearTimeout(t);
  }, [selected, scrollTo]);

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Text variant="heading">الأدوار</Text>
        <Text variant="caption" weight="semibold" color={colors.success}>
          خلص {formatNumber(doneCount)} من {formatNumber(items.length)}
        </Text>
      </View>
      {rows.map((row, r) => (
        <View
          key={r}
          ref={(v) => {
            rowRefs.current[r] = v;
          }}
          collapsable={false}
          style={{ gap: space.sm }}
        >
      <View style={styles.grid}>
        {row.map((x) => {
          const green = x.state === 'done';
          const waiting = x.state === 'awaiting' || x.state === 'collected';
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
                ) : waiting ? (
                  <Ionicons name={x.state === 'awaiting' ? 'hourglass' : 'cash'} size={24} color={colors.white} />
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
