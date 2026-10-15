import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  formatDate,
  formatMoney,
  METHOD_LABEL,
  PAYMENT_METHODS,
  payTarget,
  requiresReceipt,
  type Circle,
  type PaymentMethod,
  type TimelineEntry,
} from '@/core';
import { claimPayment } from '@/data';
import { Button, Field, Row, Text, tap } from '@/ui/components';
import { Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

import { pickReceipt, type PickedReceipt } from './receiptImage';

export const METHOD_ICON: Record<PaymentMethod, ComponentProps<typeof Ionicons>['name']> = {
  cash: 'cash-outline',
  instapay: 'flash-outline',
  vodafone_cash: 'phone-portrait-outline',
};

/** Member "I paid" flow: pick how you paid; transfers need a screenshot. */
export function PaySheet({
  circle,
  entry,
  memberId,
  uid,
  onClose,
}: {
  circle: Circle;
  entry: TimelineEntry | null;
  memberId: string;
  uid: string;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const { busy, run } = useAction();

  // Fresh state every time the sheet opens for a period.
  useEffect(() => {
    setMethod('cash');
    setReceipt(null);
    setNote('');
  }, [entry?.period.id]);

  if (!entry) return null;
  const needsReceipt = requiresReceipt(method);
  const target = payTarget(method, circle.payInfo);

  const choose = async (source: 'library' | 'camera') => {
    setPicking(true);
    try {
      const picked = await pickReceipt(source);
      if (picked) setReceipt(picked);
    } catch {
      Alert.alert('معلش', 'مقدرناش نفتح الصورة. جرّب تاني.');
    } finally {
      setPicking(false);
    }
  };

  const submit = () =>
    run(
      async () => {
        await claimPayment(circle.id, entry.period.id, memberId, uid, {
          method,
          receiptBase64: needsReceipt ? receipt?.base64 : undefined,
          note,
        });
        onClose();
      },
      { success: 'وصل لصاحب الجمعية، ومستني تأكيده.' },
    );

  return (
    <Sheet visible title="دفعت القسط" onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          {formatMoney(entry.due, circle.currency)} • {formatDate(entry.date)}
        </Text>

        <Text weight="semibold">دفعت إزاي؟</Text>
        <Row gap={space.sm}>
          {PAYMENT_METHODS.map((m) => {
            const active = m === method;
            return (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  tap();
                  setMethod(m);
                }}
                style={[styles.method, active && styles.methodActive]}
              >
                <Ionicons name={METHOD_ICON[m]} size={22} color={active ? colors.white : colors.primary} />
                <Text variant="caption" weight="bold" color={active ? colors.white : colors.text}>
                  {METHOD_LABEL[m]}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {target && (
          <Pressable
            style={styles.target}
            onPress={() => {
              Clipboard.setStringAsync(target).catch(() => {});
              Alert.alert('اتنسخ ✓', target);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="caption">حوّل على</Text>
              <Text weight="bold" selectable>
                {target}
              </Text>
            </View>
            <Ionicons name="copy-outline" size={20} color={colors.primary} />
          </Pressable>
        )}

        {needsReceipt && (
          <View style={{ gap: space.sm }}>
            <Text weight="semibold">صورة التحويل (مطلوبة)</Text>
            {receipt ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: receipt.uri }} style={styles.preview} resizeMode="contain" />
                <Button label="غيّر الصورة" icon="refresh" variant="ghost" onPress={() => setReceipt(null)} />
              </View>
            ) : (
              <Row gap={space.sm}>
                <Button
                  label="من الصور"
                  icon="images-outline"
                  variant="secondary"
                  style={{ flex: 1 }}
                  loading={picking}
                  onPress={() => choose('library')}
                />
                <Button
                  label="صوّر"
                  icon="camera-outline"
                  variant="secondary"
                  style={{ flex: 1 }}
                  disabled={picking}
                  onPress={() => choose('camera')}
                />
              </Row>
            )}
          </View>
        )}

        <Field label="ملاحظة (اختياري)" value={note} onChangeText={setNote} maxLength={200} placeholder="مثلًا: رقم العملية" />

        <Button
          label="ابعت لصاحب الجمعية"
          icon="send"
          loading={busy}
          disabled={needsReceipt && !receipt}
          onPress={submit}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  method: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  methodActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
  },
  previewWrap: { gap: space.xs, alignItems: 'center' },
  preview: { width: '100%', height: 260, borderRadius: radius.md, backgroundColor: colors.border },
});
