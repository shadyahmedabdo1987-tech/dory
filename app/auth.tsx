import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { normalizePhone } from '@/core';
import { signInAdmin, signUpAdmin } from '@/data';
import { Button, Card, Field, Segmented, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { useAction } from '@/ui/feedback';
import { KeyboardScreen } from '@/ui/KeyboardScreen';
import { writePrefs } from '@/ui/prefs';
import { colors, space } from '@/ui/theme';

type Mode = 'signin' | 'signup';

/** Organizer account: mobile number + password, exactly like the members. */
export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { busy, run } = useAction();

  const phoneOk = !!normalizePhone(phone);

  const submit = () =>
    run(async () => {
      if (mode === 'signup') await signUpAdmin(name, phone, password);
      else await signInAdmin(phone, password);
      writePrefs({ myPhone: phone.trim() });
      router.back();
    });

  const forgot = () =>
    alert(
      'نسيت الرقم السري؟',
      'كلّم صاحب التطبيق من نفس رقمك وهيرجّعلك حسابك.',
    );

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text color={colors.muted}>
          سجّل برقم موبايلك ورقم سري، زي الأعضاء بالظبط. لو غيّرت موبايلك، ادخل بنفس الرقم والرقم السري وهتلاقي كل جمعياتك زي ما هي.
        </Text>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'signup', label: 'حساب جديد' },
            { value: 'signin', label: 'عندي حساب' },
          ]}
        />
        <Card>
          {mode === 'signup' && <Field label="اسمك" value={name} onChangeText={setName} placeholder="مثلًا: شادي" />}
          <Field
            label="رقم الموبايل"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoComplete="tel"
            placeholder="01xxxxxxxxx"
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          <Field
            label="الرقم السري"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? '٦ حروف أو أرقام أو أكتر — احفظه كويس' : undefined}
          />
          <Button
            label={mode === 'signup' ? 'إنشاء الحساب' : 'دخول'}
            icon="log-in-outline"
            loading={busy}
            disabled={!phoneOk || password.length < 6 || (mode === 'signup' && !name.trim())}
            onPress={submit}
          />
          {mode === 'signin' && <Button label="نسيت الرقم السري" variant="ghost" onPress={forgot} />}
        </Card>
      </ScrollView>
    </KeyboardScreen>
  );
}
