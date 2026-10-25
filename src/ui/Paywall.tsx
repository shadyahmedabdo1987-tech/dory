import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buyFull, listenToPurchases, restorePurchases, startTrial, TRIAL_DAYS, useLicense } from '@/billing/license';
import { formatNumber } from '@/core';

import { Button, Card, Text } from './components';
import { alert } from './dialog';
import { colors, space } from './theme';

/** Shown over the app on iPhone's first run (start the free trial) and when the trial is over. */
export function Paywall() {
  const { license, price } = useLicense();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'trial' | 'buy' | 'restore' | null>(null);

  useEffect(() => listenToPurchases((m) => alert('معلش', m)), []);

  if (license.state !== 'expired' && license.state !== 'start-trial') return null;
  const shownPrice = price ?? '٢٠٠ ج.م.';
  const go = async (what: 'trial' | 'buy' | 'restore') => {
    setBusy(what);
    try {
      if (what === 'trial') await startTrial();
      else if (what === 'buy') await buyFull();
      else {
        const l = await restorePurchases();
        if (l.state !== 'full' && l.state !== 'trial') alert('مفيش مشتريات', 'ملقيناش شراء سابق على الحساب ده.');
      }
    } catch {
      // the store shows its own message; errors arrive through the listener
    } finally {
      setBusy(null);
    }
  };

  const first = license.state === 'start-trial';
  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }}>
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Image source={require('../../assets/logo-coin.png')} style={{ width: 96, height: 96 }} />
          <Text weight="bold" color={colors.white} center style={{ fontSize: 26, lineHeight: 40 }}>
            {first ? `جرّب دوري مجانًا ${formatNumber(TRIAL_DAYS)} يوم` : 'خلصت فترة التجربة'}
          </Text>
          <Text color="rgba(255,255,255,0.85)" center>
            {first
              ? `كل مميزات دوري مفتوحة ${formatNumber(TRIAL_DAYS)} يوم ببلاش. بعدها النسخة الكاملة بـ ${shownPrice} مرة واحدة بس — من غير اشتراك شهري.`
              : `علشان تكمل تستخدم دوري، اشتري النسخة الكاملة بـ ${shownPrice} مرة واحدة بس — من غير اشتراك، وبتفضل معاك على طول.`}
          </Text>
        </View>
        <Card>
          {['تنظيم الجمعيات والأدوار والأقساط', 'متابعة الدفع والقبض لكل عضو', 'التذكيرات والرسائل والتقارير'].map((t) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={{ flex: 1 }}>{t}</Text>
            </View>
          ))}
        </Card>
        {first ? (
          <Button label={`ابدأ التجربة المجانية (${formatNumber(TRIAL_DAYS)} يوم)`} icon="gift-outline" loading={busy === 'trial'} onPress={() => go('trial')} style={styles.gold} />
        ) : null}
        <Button
          label={`اشتري النسخة الكاملة — ${shownPrice}`}
          icon="lock-open-outline"
          variant={first ? 'secondary' : 'primary'}
          loading={busy === 'buy'}
          onPress={() => go('buy')}
          style={first ? undefined : styles.gold}
        />
        <Button label="استرجاع مشترياتي" icon="refresh" variant="ghost" loading={busy === 'restore'} onPress={() => go('restore')} />
        <Text variant="caption" color="rgba(255,255,255,0.7)" center>
          الشراء مرة واحدة على حساب المتجر بتاعك، وتقدر ترجّعه على أي موبايل بنفس الحساب من "استرجاع مشترياتي".
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: '#0F5C4D', zIndex: 1500, elevation: 1500 },
  gold: { backgroundColor: colors.gold },
});
