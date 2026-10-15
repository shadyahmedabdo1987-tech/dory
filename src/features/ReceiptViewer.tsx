import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadReceipt, arabicError } from '@/data';
import { Text } from '@/ui/components';
import { colors, space } from '@/ui/theme';

/** Full-screen view of a transfer screenshot, with optional actions underneath. */
export function ReceiptViewer({
  circleId,
  paymentId,
  title,
  subtitle,
  onClose,
  footer,
}: {
  circleId: string;
  paymentId: string | null;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    setImage(null);
    setError(undefined);
    loadReceipt(circleId, paymentId)
      .then((uri) => {
        if (cancelled) return;
        if (uri) setImage(uri);
        else setError('مفيش صورة مرفقة.');
      })
      .catch((e) => !cancelled && setError(arabicError(e)));
    return () => {
      cancelled = true;
    };
  }, [circleId, paymentId]);

  return (
    <Modal visible={!!paymentId} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text weight="bold" color={colors.white}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" color="rgba(255,255,255,0.7)">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="إغلاق">
            <Ionicons name="close" size={28} color={colors.white} />
          </Pressable>
        </View>
        <View style={styles.body}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} resizeMode="contain" />
          ) : error ? (
            <Text color={colors.white}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.white} size="large" />
          )}
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F0E' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.md },
  image: { width: '100%', height: '100%' },
  footer: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
});
