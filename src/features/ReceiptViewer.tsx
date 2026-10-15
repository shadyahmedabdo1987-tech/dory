import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { arabicError } from '@/data';
import { Text } from '@/ui/components';
import { colors, space } from '@/ui/theme';

/** Full-screen view of a transfer screenshot, with optional actions underneath. */
export interface ReceiptSource {
  /** Changes whenever a different image should be shown. */
  key: string;
  load: () => Promise<string | null>;
}

export function ReceiptViewer({
  source,
  title,
  subtitle,
  onClose,
  footer,
}: {
  source: ReceiptSource | null;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setImage(null);
    setError(undefined);
    source
      .load()
      .then((uri) => {
        if (cancelled) return;
        if (uri) setImage(uri);
        else setError('مفيش صورة مرفقة.');
      })
      .catch((e) => !cancelled && setError(arabicError(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.key]);

  return (
    <Modal visible={!!source} animationType="fade" onRequestClose={onClose}>
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
