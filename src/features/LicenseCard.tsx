import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform } from 'react-native';

import { buyFull, restorePurchases, useLicense } from '@/billing/license';
import { formatNumber } from '@/core';
import { Badge, Button, Card, Row, Text } from '@/ui/components';
import { colors, space } from '@/ui/theme';

/** Account screen: trial days left / full version, with buy and restore. */
export function LicenseCard() {
  const { license, price } = useLicense();
  const [busy, setBusy] = useState(false);
  if (Platform.OS === 'web' || license.state === 'checking') return null;
  const full = license.state === 'full';
  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name={full ? 'ribbon' : 'gift-outline'} size={22} color={full ? colors.success : colors.gold} />
        <Text variant="heading" style={{ flex: 1 }}>
          {full ? 'النسخة الكاملة' : 'الفترة التجريبية'}
        </Text>
        {full ? (
          <Badge label="مفعّلة ✓" tone="success" />
        ) : license.state === 'trial' ? (
          <Badge label={`فاضل ${formatNumber(license.daysLeft)} يوم`} tone="gold" />
        ) : null}
      </Row>
      <Text variant="caption">
        {full
          ? 'شكرًا إنك اشتريت دوري — كل المميزات مفتوحة على طول.'
          : `اشتري النسخة الكاملة بـ ${price ?? '٢٠٠ ج.م.'} مرة واحدة، من غير اشتراك.`}
      </Text>
      {!full ? (
        <Button
          label={`اشتري النسخة الكاملة — ${price ?? '٢٠٠ ج.م.'}`}
          icon="lock-open-outline"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await buyFull().catch(() => {});
            setBusy(false);
          }}
        />
      ) : null}
      {!full ? <Button label="استرجاع مشترياتي" icon="refresh" variant="ghost" onPress={() => restorePurchases()} /> : null}
    </Card>
  );
}
