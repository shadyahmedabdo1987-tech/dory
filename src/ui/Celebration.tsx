import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors } from './theme';

const PIECES = 18;

/** "The circle is over": a trophy that pops in with light rays, and confetti falling. */
export function Celebration({ size = 96, height = 220 }: { size?: number; height?: number }) {
  const pop = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const fall = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: `${(i * 97) % 100}%` as `${number}%`,
        delay: (i * 0.137) % 1,
        color: [colors.gold, '#3DDC97', colors.orange, colors.white][i % 4],
        w: 6 + (i % 3) * 2,
        turn: (i % 2 ? 1 : -1) * (180 + (i % 5) * 90),
      })),
    [],
  );

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
    const rays = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    const rain = Animated.loop(Animated.timing(fall, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }));
    rays.start();
    rain.start();
    return () => {
      rays.stop();
      rain.stop();
    };
  }, [pop, spin, fall]);

  return (
    <View style={{ height, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} pointerEvents="none">
      {pieces.map((p, i) => {
        // Each piece runs the same loop shifted by its own delay.
        const t = Animated.modulo(Animated.add(fall, p.delay), 1);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: -20,
              left: p.left,
              width: p.w,
              height: p.w * 1.8,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.turn}deg`] }) },
              ],
            }}
          />
        );
      })}
      <Animated.View
        style={[
          styles.rays,
          {
            width: size * 2.2,
            height: size * 2.2,
            borderRadius: size * 1.1,
            opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
            transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
          },
        ]}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: 4,
              height: size * 1.1,
              top: 0,
              left: size * 1.1 - 2,
              backgroundColor: 'rgba(245,184,65,0.18)',
              transform: [{ translateY: size * 0.55 }, { rotate: `${i * 30}deg` }, { translateY: -size * 0.55 }],
            }}
          />
        ))}
      </Animated.View>
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(201,162,63,0.22)',
          borderWidth: 2,
          borderColor: colors.gold,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
        }}
      >
        <Ionicons name="trophy" size={size * 0.52} color={colors.gold} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rays: { position: 'absolute' },
});
