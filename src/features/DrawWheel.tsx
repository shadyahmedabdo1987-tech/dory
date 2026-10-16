import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle, Path, Polygon } from 'react-native-svg';

import { formatNumber, ordinal, spinTarget } from '@/core';
import { Button, Row, Text } from '@/ui/components';
import { colors, radius, space } from '@/ui/theme';

export interface WheelEntry {
  /** Unique per slot (a member with two turns appears twice). */
  key: string;
  /** Value returned in the final order (member id). */
  value: string;
  name: string;
}

const SLICE_COLORS = [
  { fill: colors.primary, text: colors.white },
  { fill: colors.gold, text: '#3B2A05' },
  { fill: '#1E7A66', text: colors.white },
  { fill: '#F2E3B6', text: colors.primaryDark },
];

const SPIN_MS = 4200;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number) {
  const a = polar(cx, cy, r, start);
  const b = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y} Z`;
}

function shortName(name: string, max: number) {
  const n = name.trim();
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
}

function haptic(kind: 'tick' | 'win') {
  if (Platform.OS === 'web') return;
  if (kind === 'win') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.selectionAsync().catch(() => {});
}

/** Unbiased random index (crypto when available). */
function randomIndex(n: number): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    do c.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

/**
 * The turn draw (القرعة) as a spinning wheel: every spin picks the next turn,
 * the winner leaves the wheel, and the order builds up until everyone has a turn.
 */
export function DrawWheel({
  visible,
  entries,
  title = 'قرعة الأدوار',
  onDone,
  onClose,
}: {
  visible: boolean;
  entries: WheelEntry[];
  title?: string;
  onDone: (orderedValues: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = Math.min(width - space.xl * 2, 340);
  const r = size / 2 - 8;
  const c = size / 2;

  const [remaining, setRemaining] = useState<WheelEntry[]>(entries);
  const [order, setOrder] = useState<WheelEntry[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<WheelEntry | null>(null);
  const [winnerTurn, setWinnerTurn] = useState(0);
  const rotation = useRef(new Animated.Value(0)).current;
  const current = useRef(0);
  const pop = useRef(new Animated.Value(0)).current;

  // Reset whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setRemaining(entries);
    setOrder([]);
    setWinner(null);
    setSpinning(false);
    rotation.setValue(0);
    current.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const n = remaining.length;
  const slice = n > 0 ? 360 / n : 360;
  const fontSize = n <= 6 ? 18 : n <= 10 ? 15 : n <= 16 ? 13 : n <= 24 ? 11 : 9;
  // Radial room for a name: from just outside the hub to just inside the rim.
  const labelWidth = r * 0.66;
  const labelHeight = fontSize * 1.8;
  const maxChars = n <= 8 ? 16 : n <= 16 ? 12 : 9;

  const slices = useMemo(
    () =>
      remaining.map((e, i) => {
        const start = i * slice;
        // Cycle colours, but never let the last slice match the first one next to it.
        let ci = i % SLICE_COLORS.length;
        if (n > 1 && i === n - 1 && ci === 0) ci = 2;
        const style = SLICE_COLORS[ci];
        return { e, i, start, end: start + slice, center: start + slice / 2, style };
      }),
    [remaining, slice, n],
  );

  const finish = (finalOrder: WheelEntry[]) => {
    setOrder(finalOrder);
    setRemaining([]);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commitWinner = (picked: WheelEntry) => {
    const nextOrder = [...order, picked];
    const rest = remaining.filter((e) => e.key !== picked.key);
    setWinner(picked);
    setWinnerTurn(nextOrder.length - 1);
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
    haptic('win');
    // Let everyone see the slice under the pointer before it leaves the wheel.
    setSpinning(true);
    timer.current = setTimeout(() => {
      // The last name takes the last turn automatically.
      if (rest.length === 1) finish([...nextOrder, rest[0]]);
      else {
        setOrder(nextOrder);
        setRemaining(rest);
      }
      rotation.setValue(0);
      current.current = 0;
      setSpinning(false);
    }, 1300);
  };

  const spin = () => {
    if (spinning || n === 0) return;
    if (n === 1) return commitWinner(remaining[0]);
    const index = randomIndex(n);
    const target = spinTarget(n, index, current.current, 5 + randomIndex(3));
    setSpinning(true);
    setWinner(null);
    haptic('tick');
    Animated.timing(rotation, {
      toValue: target,
      duration: SPIN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      current.current = target;
      if (finished) commitWinner(remaining[index]);
      else setSpinning(false);
    });
  };

  /** Finish the rest instantly (for big circles). */
  const drawRest = () => {
    const pool = [...remaining];
    const picked: WheelEntry[] = [];
    while (pool.length) picked.push(pool.splice(randomIndex(pool.length), 1)[0]);
    haptic('win');
    setWinner(null);
    finish([...order, ...picked]);
  };

  const done = remaining.length === 0 && order.length > 0;
  const rotate = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'], extrapolate: 'extend' });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.md }]}>
        <Row style={styles.header}>
          <Text variant="heading" color={colors.white} style={{ flex: 1 }}>
            {title}
          </Text>
          <Button label="إغلاق" variant="ghost" onPress={onClose} style={{ minHeight: 40 }} />
        </Row>

        <ScrollView contentContainerStyle={{ alignItems: 'center', gap: space.lg, paddingBottom: space.lg }}>
          <Text color="rgba(255,255,255,0.8)" center>
            {done
              ? 'الترتيب اكتمل ✓ راجع الأدوار واعتمدها.'
              : `لف العجلة علشان تطلّع ${order.length === 0 ? 'صاحب الدور الأول' : `الدور ${ordinal(order.length)}`}`}
          </Text>

          {!done && (
            <View style={{ width: size, height: size + 18 }}>
              {/* Pointer */}
              <View style={styles.pointerWrap} pointerEvents="none">
                <Svg width={36} height={34}>
                  <Polygon points="18,32 4,4 32,4" fill={colors.danger} stroke={colors.white} strokeWidth={2} />
                </Svg>
              </View>
              <Animated.View style={{ width: size, height: size, marginTop: 18, transform: [{ rotate }] }}>
                <Svg width={size} height={size}>
                  <SvgCircle cx={c} cy={c} r={r + 6} fill={colors.gold} />
                  {n === 1 ? (
                    <SvgCircle cx={c} cy={c} r={r} fill={SLICE_COLORS[0].fill} />
                  ) : (
                    slices.map(({ e, start, end, style }) => (
                      <Path key={e.key} d={slicePath(c, c, r, start, end)} fill={style.fill} stroke={colors.white} strokeWidth={1.5} />
                    ))
                  )}
                  <SvgCircle cx={c} cy={c} r={size * 0.09} fill={colors.white} stroke={colors.gold} strokeWidth={4} />
                </Svg>
                {/* Names are native Text (proper Arabic shaping), laid out with transforms so RTL can't mirror them. */}
                {slices.map(({ e, center, style }) => {
                  const rad = (center * Math.PI) / 180;
                  const rho = r * 0.6;
                  // Read along the radius; flip on the left half so names are never upside down.
                  const angle = center <= 180 ? center - 90 : center + 90;
                  return (
                    <View
                      key={`t-${e.key}`}
                      pointerEvents="none"
                      style={[
                        styles.label,
                        {
                          width: labelWidth,
                          height: labelHeight,
                          top: c - labelHeight / 2,
                          left: c - labelWidth / 2,
                          transform: [
                            { translateX: rho * Math.sin(rad) },
                            { translateY: -rho * Math.cos(rad) },
                            { rotate: `${angle}deg` },
                          ],
                        },
                      ]}
                    >
                      <Text
                        weight="bold"
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                        color={n === 1 ? colors.white : style.text}
                        style={{ fontSize, lineHeight: fontSize * 1.6, textAlign: 'center', writingDirection: 'rtl' }}
                      >
                        {shortName(e.name, maxChars)}
                      </Text>
                    </View>
                  );
                })}
              </Animated.View>
            </View>
          )}

          {winner && (
            <Animated.View
              style={[
                styles.winner,
                { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
              ]}
            >
              <Text variant="caption" color="#3B2A05">
                الدور {ordinal(winnerTurn)}
              </Text>
              <Text variant="heading" weight="bold" color="#3B2A05">
                🎉 {winner.name}
              </Text>
            </Animated.View>
          )}

          {!done && (
            <View style={{ alignSelf: 'stretch', gap: space.sm, paddingHorizontal: space.xl }}>
              <Button label={spinning ? 'العجلة بتلف…' : 'لف العجلة'} icon="sync" disabled={spinning} onPress={spin} style={styles.spinButton} />
              {n > 3 && <Button label="كمّل الباقي مرة واحدة" icon="flash-outline" variant="ghost" disabled={spinning} onPress={drawRest} />}
            </View>
          )}

          {order.length > 0 && (
            <View style={styles.orderCard}>
              <Text weight="bold">الترتيب ({formatNumber(order.length)} من {formatNumber(entries.length)})</Text>
              {order.map((e, i) => (
                <Row key={e.key} gap={space.md} style={styles.orderRow}>
                  <View style={styles.num}>
                    <Text weight="bold" color={colors.primary}>
                      {formatNumber(i + 1)}
                    </Text>
                  </View>
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {e.name}
                  </Text>
                  {i === order.length - 1 && !done && <Ionicons name="sparkles" size={16} color={colors.gold} />}
                </Row>
              ))}
            </View>
          )}
        </ScrollView>

        {done && (
          <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
            <Button label="اعتمد الترتيب" icon="checkmark-circle" onPress={() => onDone(order.map((e) => e.value))} style={styles.spinButton} />
            <Button
              label="إعادة القرعة"
              icon="refresh"
              variant="ghost"
              onPress={() => {
                setRemaining(entries);
                setOrder([]);
                setWinner(null);
              }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: colors.primaryDark },
  header: { paddingHorizontal: space.lg, marginBottom: space.sm },
  pointerWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  winner: {
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  spinButton: { backgroundColor: colors.gold, borderColor: colors.gold },
  orderCard: {
    alignSelf: 'stretch',
    marginHorizontal: space.lg,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  orderRow: { paddingVertical: space.xs },
  num: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
