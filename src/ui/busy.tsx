import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet } from 'react-native';

import { SpinningLogo } from './SpinningLogo';

/**
 * App-wide "working…" overlay: the spinning logo shown briefly whenever an
 * action runs (join, leave, save, pay, send…). Ref-counted so overlapping
 * actions show one overlay; always visible for at least MIN_MS so it never flickers.
 */
const MIN_MS = 700;
let active = 0;
let shownAt = 0;
const listeners = new Set<(on: boolean) => void>();
const emit = (on: boolean) => listeners.forEach((l) => l(on));

export function beginBusy() {
  active++;
  if (active === 1) {
    shownAt = Date.now();
    emit(true);
  }
}

/** Resolves once the overlay is gone, so a following message doesn't sit under it. */
export async function endBusy(): Promise<void> {
  const wait = Math.max(0, MIN_MS - (Date.now() - shownAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  active = Math.max(0, active - 1);
  if (active === 0) emit(false);
}

/** Mount once at the app root. */
export function BusyHost() {
  const [on, setOn] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);

  useEffect(() => {
    if (on) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [on, fade]);

  if (!on) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <SpinningLogo size={110} />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10, 66, 56, 0.82)', alignItems: 'center', justifyContent: 'center' },
});
