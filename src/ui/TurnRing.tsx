import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { formatNumber } from '@/core';

import { Text } from './components';
import { colors } from './theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The turn being collected, as a ring cut into one piece per installment.
 * Every payment fills its piece (animated); when the last one lands the ring
 * glows and a check pops in the middle.
 */
export function TurnRing({
  total,
  paid,
  title,
  size = 168,
  onDark = true,
}: {
  total: number;
  paid: number;
  title: string;
  size?: number;
  onDark?: boolean;
}) {
  const n = Math.max(1, total);
  const done = Math.min(paid, n);
  const progress = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(done >= n ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const key = `${title}:${n}`;
  const lastKey = useRef(key);
  const at = useRef(0);

  useEffect(() => {
    // A new turn starts from empty and fills up again.
    if (lastKey.current !== key) {
      lastKey.current = key;
      progress.setValue(0);
      at.current = 0;
      check.setValue(0);
    }
    const id = progress.addListener(({ value }) => {
      at.current = value;
      setShown(Math.floor(value + 0.001));
    });
    Animated.timing(progress, {
      toValue: done,
      duration: 450 + 350 * Math.abs(done - at.current),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      if (done >= n) {
        Animated.parallel([
          Animated.spring(check, { toValue: 1, friction: 4, tension: 80, useNativeDriver: false }),
          Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: 350, useNativeDriver: false }),
            Animated.timing(glow, { toValue: 0, duration: 700, useNativeDriver: false }),
          ]),
        ]).start();
      } else {
        check.setValue(0);
      }
    });
    return () => progress.removeListener(id);
  }, [done, n, key, progress, check, glow]);

  const stroke = Math.max(10, Math.round(size * 0.085));
  const r = (size - stroke) / 2 - 4;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapDeg = n > 1 ? Math.min(10, 120 / n) : 0;
  const segDeg = 360 / n - gapDeg;
  const segLen = (circumference * segDeg) / 360;
  const complete = done >= n;
  const fillColor = complete ? colors.success : colors.gold;
  const track = onDark ? 'rgba(255,255,255,0.16)' : colors.border;
  const ink = onDark ? colors.white : colors.text;

  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View style={{ width: size, height: size }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            inset: -10,
            borderRadius: size,
            backgroundColor: colors.success,
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }),
            transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) }],
          }}
        />
        <Svg width={size} height={size}>
          {Array.from({ length: n }, (_, i) => {
            const rotation = -90 + i * (360 / n) + gapDeg / 2;
            const fill = progress.interpolate({ inputRange: [i, i + 1], outputRange: [0, 1], extrapolate: 'clamp' });
            return (
              <G key={i}>
                <Circle
                  cx={c}
                  cy={c}
                  r={r}
                  stroke={track}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${segLen} ${circumference}`}
                  rotation={rotation}
                  origin={`${c}, ${c}`}
                />
                <AnimatedCircle
                  cx={c}
                  cy={c}
                  r={r}
                  stroke={fillColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${segLen} ${circumference}`}
                  strokeDashoffset={fill.interpolate({ inputRange: [0, 1], outputRange: [segLen, 0] })}
                  opacity={fill.interpolate({ inputRange: [0, 0.02, 1], outputRange: [0, 1, 1] })}
                  rotation={rotation}
                  origin={`${c}, ${c}`}
                />
              </G>
            );
          })}
        </Svg>
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          {complete ? (
            <Animated.View
              style={{
                width: size * 0.42,
                height: size * 0.42,
                borderRadius: size,
                backgroundColor: colors.success,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
                opacity: check,
              }}
            >
              <Ionicons name="checkmark" size={size * 0.28} color={colors.white} />
            </Animated.View>
          ) : (
            <>
              <Text weight="bold" color={ink} style={{ fontSize: size * 0.2, lineHeight: size * 0.27 }}>
                {formatNumber(Math.min(shown, n))}/{formatNumber(n)}
              </Text>
              <Text color={onDark ? 'rgba(255,255,255,0.75)' : colors.muted} style={{ fontSize: 12, lineHeight: 18 }}>
                دفعوا
              </Text>
            </>
          )}
        </View>
      </View>
      <Text weight="bold" color={ink} center numberOfLines={1} style={{ fontSize: 14, lineHeight: 22 }}>
        {complete ? `${title} — اكتمل ✓` : title}
      </Text>
    </View>
  );
}
