import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { resetPassword, signInAdmin, signUpAdmin } from '@/data';
import { Button, Card, Field, Segmented, Text } from '@/ui/components';
import { useAction } from '@/ui/feedback';
import { space } from '@/ui/theme';
import { alert } from '@/ui/dialog';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, run } = useAction();

  const submit = () =>
    run(async () => {
      if (mode === 'signup') await signUpAdmin(name, email, password);
      else await signInAdmin(email, password);
      router.back();
    });

  const forgot = () => {
    if (!email.trim()) return alert('اكتب إيميلك الأول', 'وبعدين دوس "نسيت كلمة السر".');
    run(() => resetPassword(email), { success: 'بعتنالك إيميل تغيّر منه كلمة السر.' });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text color="#6B7570">
          حساب صاحب الجمعية بيحفظ كل جمعياتك على السيرفر. لو غيّرت موبايلك، سجّل دخول بنفس الإيميل وهتلاقي كل حاجة زي ما هي.
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
            label="الإيميل"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="name@example.com"
          />
          <Field
            label="كلمة السر"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            hint={mode === 'signup' ? '٦ حروف أو أكتر' : undefined}
          />
          <Button
            label={mode === 'signup' ? 'إنشاء الحساب' : 'دخول'}
            icon="log-in-outline"
            loading={busy}
            disabled={!email.trim() || password.length < 6}
            onPress={submit}
          />
          {mode === 'signin' && <Button label="نسيت كلمة السر" variant="ghost" onPress={forgot} />}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
