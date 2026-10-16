import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { arabicError, errorCode } from '@/data/errors';

import { Button, Text } from './components';
import { colors, radius, space } from './theme';
import { beginBusy, endBusy } from './busy';
import { alert } from './dialog';

/**
 * Runs an async action with a busy flag and friendly Arabic errors.
 * Offline timeouts are reported as "will sync" rather than as failures.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>, options?: { success?: string }): Promise<T | undefined> => {
    if (running.current) return undefined; // ignore double taps
    running.current = true;
    setBusy(true);
    beginBusy();
    let message: [string, string] | undefined;
    try {
      const result = await fn();
      if (options?.success) message = ['تمام ✓', options.success];
      return result;
    } catch (e) {
      message = errorCode(e) === 'dory/offline-timeout' ? ['هيتحفظ قريب', arabicError(e)] : ['معلش', arabicError(e)];
      return undefined;
    } finally {
      await endBusy();
      running.current = false;
      setBusy(false);
      if (message) alert(message[0], message[1]);
    }
  }, []);

  return { busy, run };
}

export function confirm(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) =>
    alert(title, message, [
      { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* Full-window modal, so no header offset: the sheet rides up with the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="إغلاق" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text variant="heading">{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="إغلاق">
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function LoadingScreen({ label = 'جاري التحميل…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
      <Text center>{message}</Text>
      {onRetry && <Button label="جرّب تاني" icon="refresh" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16, 32, 28, 0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    padding: space.lg,
    gap: space.md,
    maxHeight: '85%',
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: colors.bg },
});
