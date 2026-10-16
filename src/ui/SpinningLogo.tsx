import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

import { Text } from './components';
import { colors, space } from './theme';

/** The app logo turning in a circle — used while something loads. */
export function SpinningLogo({ size = 140, label }: { size?: number; label?: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const rotate = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    rotate.start();
    breathe.start();
    return () => {
      rotate.stop();
      breathe.stop();
    };
  }, [spin, pulse]);

  return (
    <View style={{ alignItems: 'center', gap: space.lg }}>
      <Animated.Image
        source={require('../../assets/splash-icon.png')}
        accessibilityLabel="جاري التحميل"
        style={{
          width: size,
          height: size,
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) },
          ],
        }}
      />
      {label ? (
        <Text weight="semibold" color={colors.white} center>
          {label}
        </Text>
      ) : null}
    </View>
  );
}
