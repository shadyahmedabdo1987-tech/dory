import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { normalizePhone } from '@/core';
import { isEmail, sendAdminResetLink, signInAdmin, signUpAdmin } from '@/data';
import { Button, Card, Field, Segmented, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { Sheet, useAction } from '@/ui/feedback';
import { KeyboardScreen } from '@/ui/KeyboardScreen';
import { writePrefs } from '@/ui/prefs';
import { colors, space } from '@/ui/theme';

type Mode = 'signin' | 'signup';

/**
 * Organizer account: signs in with the mobile number + password.
 * The email is asked once at sign-up and only used for the "forgot password" link.
 */
export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const { busy, run } = useAction();

  const phoneOk = !!normalizePhone(phone);
  const emailOk = isEmail(email);

  const submit = async () => {
    const ok = await run(async () => {
      if (mode === 'signup') await signUpAdmin(name, phone, email, password);
      else await signInAdmin(phone, password);
      writePrefs({ myPhone: phone.trim() });
      return true;
    });
    if (ok) router.back();
    else setPassword(''); // nothing kept from a failed try
  };

  const sendLink = async () => {
    const ok = await run(async () => {
      await sendAdminResetLink(phone, forgotEmail);
      return true;
    });
    if (!ok) return;
    setForgotOpen(false);
    alert(
      'بعتنالك لينك على إيميلك ✓',
      'افتح الإيميل ودوس على اللينك، هيفتحلك صفحة تكتب فيها رقم سري جديد. بعدها ارجع هنا وادخل برقمك والرقم السري الجديد. لو مش لاقيه، بص في الـSpam.',
    );
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text color={colors.muted}>
          سجّل برقم موبايلك ورقم سري. لو غيّرت موبايلك، ادخل بنفس الرقم والرقم السري وهتلاقي كل جمعياتك زي ما هي.
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
            hint={mode === 'signup' ? '٦ حروف أو أرقام أو أكتر' : undefined}
          />
          {mode === 'signup' && (
            <Field
              label="إيميلك (لو نسيت الرقم السري بس)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="name@gmail.com"
              hint="مش هتدخل بيه. لو نسيت الرقم السري هنبعتلك عليه لينك تغيّره منه."
              error={email.trim() && !emailOk ? 'الإيميل مكتوب غلط' : undefined}
              style={{ textAlign: 'left', writingDirection: 'ltr' }}
            />
          )}
          <Button
            label={mode === 'signup' ? 'إنشاء الحساب' : 'دخول'}
            icon="log-in-outline"
            loading={busy}
            disabled={!phoneOk || password.length < 6 || (mode === 'signup' && (!name.trim() || !emailOk))}
            onPress={submit}
          />
          {mode === 'signin' && (
            <Button
              label="نسيت الرقم السري"
              variant="ghost"
              onPress={() => {
                setForgotEmail('');
                setForgotOpen(true);
              }}
            />
          )}
        </Card>
      </ScrollView>

      <Sheet visible={forgotOpen} title="نسيت الرقم السري" onClose={() => setForgotOpen(false)}>
        <View style={{ gap: space.md }}>
          <Text variant="caption">اكتب رقمك والإيميل اللي سجّلت بيه، وهنبعتلك عليه لينك تغيّر منه الرقم السري.</Text>
          <Field
            label="رقم الموبايل"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="01xxxxxxxxx"
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          <Field
            label="الإيميل"
            value={forgotEmail}
            onChangeText={setForgotEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="name@gmail.com"
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          <Button label="ابعتلي اللينك" icon="mail-outline" loading={busy} disabled={!phoneOk || !isEmail(forgotEmail)} onPress={sendLink} />
        </View>
      </Sheet>
    </KeyboardScreen>
  );
}
