import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sha256 } from '@/core';

import { Text, tap } from './components';
import { readPrefsSync, writePrefs } from './prefs';
import { colors, radius, space } from './theme';

export const PIN_LENGTH = 4;
/** Back within this long (e.g. after picking a receipt photo) → no lock. */
const GRACE_MS = 45_000;

export const hashPin = (pin: string) => sha256(`dory:lock:v1:${pin}`);

export function lockSettings() {
  return readPrefsSync().lock ?? null;
}

export function saveLock(pin: string, bio: boolean) {
  writePrefs({ lock: { pin: hashPin(pin), bio } });
}

export function setLockBio(bio: boolean) {
  const l = lockSettings();
  if (l) writePrefs({ lock: { ...l, bio } });
}

export function clearLock() {
  writePrefs({ lock: undefined });
}

/** Fingerprint / face available and set up on this phone? */
export async function biometricAvailable(): Promise<{ ok: boolean; face: boolean }> {
  try {
    const [hw, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return { ok: hw && enrolled, face: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) };
  } catch {
    return { ok: false, face: false };
  }
}

export async function askBiometric(prompt = 'افتح دوري'): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'استخدم الرقم السري',
      disableDeviceFallback: true,
    });
    return r.success;
  } catch {
    return false;
  }
}

/**
 * Covers the app when it opens (and when it comes back after a while) until
 * the fingerprint / face or the 4-digit code is given.
 */
export function AppLock() {
  const [locked, setLocked] = useState(() => !!lockSettings());
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') leftAt.current = Date.now();
      if (s === 'active' && leftAt.current && lockSettings() && Date.now() - leftAt.current > GRACE_MS) setLocked(true);
      if (s === 'active') leftAt.current = null;
    });
    return () => sub.remove();
  }, []);

  if (!locked) return null;
  return <LockScreen onOpen={() => setLocked(false)} />;
}

function LockScreen({ onOpen }: { onOpen: () => void }) {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [bio, setBio] = useState<{ ok: boolean; face: boolean }>({ ok: false, face: false });
  const shake = useRef(new Animated.Value(0)).current;
  const settings = lockSettings();

  const tryBio = useCallback(async () => {
    if (!settings?.bio) return;
    if (await askBiometric()) onOpen();
  }, [settings?.bio, onOpen]);

  useEffect(() => {
    biometricAvailable().then((b) => {
      setBio(b);
      if (b.ok && settings?.bio) tryBio();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = (d: string) => {
    tap();
    setError(false);
    const next = (pin + d).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) {
      if (settings && hashPin(next) === settings.pin) {
        onOpen();
      } else {
        setError(true);
        Animated.sequence(
          [12, -12, 8, -8, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 60, useNativeDriver: true })),
        ).start(() => setPin(''));
      }
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];
  return (
    <View style={[StyleSheet.absoluteFill, styles.bg, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Image source={require('../../assets/logo-coin.png')} style={{ width: 84, height: 84 }} />
        <Text weight="bold" color={colors.white} style={{ fontSize: 22, lineHeight: 34 }}>
          دوري مقفول
        </Text>
        <Text color="rgba(255,255,255,0.75)" center>
          {settings?.bio && bio.ok ? (bio.face ? 'افتحه ببصمة الوش أو الرقم السري' : 'افتحه بالبصمة أو الرقم السري') : 'اكتب الرقم السري'}
        </Text>
      </View>

      <Animated.View style={[styles.dots, { transform: [{ translateX: shake }] }]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotOn, error && styles.dotError]} />
        ))}
      </Animated.View>
      <Text color={error ? '#FFD6A5' : 'transparent'} center weight="semibold">
        الرقم السري مش صح
      </Text>

      <View style={styles.pad}>
        {keys.map((k) => {
          if (k === 'bio') {
            return settings?.bio && bio.ok ? (
              <Pressable key={k} onPress={tryBio} style={styles.key} accessibilityLabel="البصمة">
                <Ionicons name={bio.face ? 'scan-outline' : 'finger-print'} size={32} color={colors.white} />
              </Pressable>
            ) : (
              <View key={k} style={styles.key} />
            );
          }
          if (k === 'del') {
            return (
              <Pressable key={k} onPress={() => setPin(pin.slice(0, -1))} style={styles.key} accessibilityLabel="امسح">
                <Ionicons name="backspace-outline" size={28} color={colors.white} />
              </Pressable>
            );
          }
          return (
            <Pressable key={k} onPress={() => press(k)} style={({ pressed }) => [styles.key, styles.num, pressed && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Text weight="bold" color={colors.white} style={{ fontSize: 28, lineHeight: 38 }}>
                {k}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: '#0F5C4D', zIndex: 2000, elevation: 2000, alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: space.lg, direction: 'ltr' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
  dotOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  dotError: { borderColor: '#FFD6A5' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 300, justifyContent: 'center', gap: space.lg, direction: 'ltr' },
  key: { width: 76, height: 76, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  num: { backgroundColor: 'rgba(255,255,255,0.12)' },
});
