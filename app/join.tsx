import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { extractInviteCode } from '@/core';
import { ensureSignedIn, joinCircle } from '@/data';
import { Button, Card, Field, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(extractInviteCode(params.code ?? '') ?? (params.code ?? '').toUpperCase());

  // Typing keeps letters/digits only; pasting a whole invite message pulls the code out of it.
  const onCodeChange = (t: string) =>
    setCode(extractInviteCode(t) ?? t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));

  const pasteCode = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const found = extractInviteCode(text ?? '');
    if (found) setCode(found);
    else alert('مفيش كود في اللي نسخته', 'انسخ رسالة الدعوة أو كود الجمعية، وبعدين دوس "الصق الكود".');
  };
  const [phone, setPhone] = useState('');
  const { busy, run } = useAction();

  const submit = () =>
    run(async () => {
      const user = await ensureSignedIn();
      const cid = await joinCircle(code, phone, user.uid);
      router.dismissAll();
      router.push({ pathname: '/circle/[id]', params: { id: cid } });
    });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Ionicons name="people-circle" size={56} color={colors.gold} />
          <Text variant="heading" color={colors.white} center>
            تابع جمعيتك زي تطبيق البنك
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.8)" center>
            دورك، الأقساط اللي عليك، واللي دفعته — كله قدامك.
          </Text>
        </View>
        <Card>
          <Field
            label="كود الجمعية"
            value={code}
            onChangeText={onCodeChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="مثلًا: K7QX2M"
            hint="هتلاقيه في رسالة الدعوة من صاحب الجمعية"
            style={{ letterSpacing: 4, textAlign: 'center', fontSize: 20 }}
          />
          <Button label="الصق الكود" icon="clipboard-outline" variant="secondary" onPress={pasteCode} />
          <Field
            label="رقم موبايلك"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="01xxxxxxxxx"
            hint="لازم يكون نفس الرقم اللي صاحب الجمعية سجّله"
          />
          <Button
            label="ادخل الجمعية"
            icon="enter-outline"
            loading={busy}
            disabled={code.trim().length < 6 || phone.trim().length < 8}
            onPress={submit}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
});
