import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { normalizePhone } from '@/core';
import { createRecoveryCode, signInAdmin, signUpAdmin } from '@/data';
import { Button, Card, Field, Segmented, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { ForgotPasswordSheet, RecoveryCodeSheet } from '@/features/RecoveryCode';
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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const { busy, run } = useAction();

  const phoneOk = !!normalizePhone(phone);

  const submit = async () => {
    const ok = await run(async () => {
      if (mode === 'signup') await signUpAdmin(name, phone, password);
      else await signInAdmin(phone, password);
      writePrefs({ myPhone: phone.trim() });
      return true;
    });
    if (!ok) return;
    if (mode === 'signin') return router.back();
    // New account: give the recovery code right away (sent to the owner's own WhatsApp).
    const code = await createRecoveryCode(password).catch(() => null);
    if (code) setRecovery(code);
    else {
      alert('الحساب اتعمل ✓', 'اعمل كود استرجاع من صفحة حسابك، علشان لو نسيت الرقم السري.');
      router.back();
    }
  };

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
          {mode === 'signin' && <Button label="نسيت الرقم السري" variant="ghost" onPress={() => setForgotOpen(true)} />}
        </Card>
      </ScrollView>
      <ForgotPasswordSheet
        visible={forgotOpen}
        initialPhone={phone}
        onClose={() => setForgotOpen(false)}
        onDone={(p) => {
          setForgotOpen(false);
          writePrefs({ myPhone: p.trim() });
          router.back();
        }}
      />
      <RecoveryCodeSheet
        code={recovery}
        phone={phone}
        onClose={() => {
          setRecovery(null);
          router.back();
        }}
      />
    </KeyboardScreen>
  );
}
