import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Text } from './components';
import { colors } from './theme';

const SIZE = 180; // same on-screen size as the native splash logo, so the hand-off is seamless
const MIN_MS = 1500;

/**
 * Opening animation: picks up exactly where the native splash leaves off —
 * the arrow ring turns around the coin, the name rises in, and the whole
 * thing lifts away to reveal the app. Keeps turning while the app finishes
 * loading, then leaves once `ready`.
 */
export function IntroSplash({ ready, onShown, onDone }: { ready: boolean; onShown?: () => void; onDone: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  const coin = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const mountedAt = useRef(Date.now()).current;
  const leaving = useRef(false);

  useEffect(() => {
    const turn = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: true }),
    );
    turn.start();
    Animated.parallel([
      Animated.spring(coin, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(title, { toValue: 1, duration: 600, delay: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    return () => turn.stop();
  }, [spin, coin, title]);

  useEffect(() => {
    if (!ready || leaving.current) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - mountedAt));
    const t = setTimeout(() => {
      // Marked only once it really starts: a re-run in between must not leave the intro up forever.
      leaving.current = true;
      Animated.timing(exit, { toValue: 1, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onDone());
    }, wait);
    return () => clearTimeout(t);
  }, [ready, exit, mountedAt, onDone]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const coinScale = coin.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const coinFlip = coin.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onShown}
      style={[
        StyleSheet.absoluteFill,
        styles.bg,
        { opacity: exit.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 1, 0] }) },
      ]}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: exit.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
          transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        }}
      >
        <View style={{ width: SIZE, height: SIZE }}>
          <Animated.Image
            source={require('../../assets/logo-ring.png')}
            style={[styles.layer, { transform: [{ rotate }] }]}
          />
          <Animated.Image
            source={require('../../assets/logo-coin.png')}
            accessibilityLabel="دوري"
            style={[styles.layer, { transform: [{ perspective: 600 }, { rotateY: coinFlip }, { scale: coinScale }] }]}
          />
        </View>
        <Animated.View
          style={{
            // Below the logo without pushing it: the logo stays exactly where the native splash had it.
            position: 'absolute',
            top: SIZE + 18,
            left: (SIZE - 320) / 2,
            width: 320,
            alignItems: 'center',
            opacity: title,
            transform: [{ translateY: title.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
          }}
        >
          <Text
            weight="bold"
            color={colors.white}
            // Full width: the text can be measured before the Cairo font arrives,
            // and a width sized to that measurement cut off the last letter.
            style={{ fontSize: 40, lineHeight: 72, width: "100%", textAlign: "center" }}
          >
            دوري
          </Text>
          <Text color="rgba(255,255,255,0.75)" style={{ fontSize: 15, lineHeight: 26, width: "100%", textAlign: "center" }}>
            جمعيتك في جيبك… بأمان
          </Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.credit, { opacity: title }]}>
        {/* Full width: measured before the font loads, a hugging width cut the name off. */}
        <Text color="rgba(255,255,255,0.65)" style={{ fontSize: 13, lineHeight: 22, letterSpacing: 1, writingDirection: 'ltr', width: '100%', textAlign: 'center' }}>
          Powered by{' '}
          <Text weight="bold" color={colors.gold} style={{ fontSize: 13 }}>
            Shady Ahmed
          </Text>
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: '#0F5C4D', alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  layer: { position: 'absolute', width: SIZE, height: SIZE },
  credit: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
});
