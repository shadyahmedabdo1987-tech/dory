import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { normalizePhone, whatsappUrl } from '@/core';
import { changeAdminPassword, recoveryWhatsappText, renewRecoveryCode, resetPasswordWithCode } from '@/data';
import { hasSavedPassword, rememberPassword, unlockSavedPassword, UnlockError } from '@/ui/savedPassword';
import { Button, Card, Field, Row, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

/** Shows a recovery code once, with "send it to my own WhatsApp". */
export function RecoveryCodeSheet({ code, phone, onClose }: { code: string | null; phone: string; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const send = () => {
    setSent(true);
    Linking.openURL(whatsappUrl(phone, recoveryWhatsappText(code ?? ''))).catch(() =>
      alert('مش لاقي واتساب', 'انسخ الكود واحفظه في مكان آمن.'),
    );
  };
  const close = async () => {
    if (!sent && !(await confirm('حفظت الكود؟', 'لو نسيت الرقم السري من غير الكود ده، مش هتعرف ترجع حسابك.', 'أيوه حفظته'))) return;
    setSent(false);
    onClose();
  };
  return (
    <Sheet visible={!!code} title="كود استرجاع حسابك" onClose={close}>
      <View style={{ gap: space.md }}>
        <Text center>
          الكود ده بيرجّعلك حسابك لو نسيت الرقم السري. ابعته لنفسك على واتساب، أو صوّر الشاشة، ومتديهوش لحد.
        </Text>
        <View
          style={{
            padding: space.lg,
            borderRadius: radius.md,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: colors.primary,
            backgroundColor: colors.primarySoft,
          }}
        >
          <Text
            weight="bold"
            center
            selectable
            color={colors.primary}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ fontSize: 26, lineHeight: 38, letterSpacing: 2, writingDirection: 'ltr' }}
          >
            {code}
          </Text>
        </View>
        <Button label="ابعته لنفسي على واتساب" icon="logo-whatsapp" onPress={send} />
        <Button
          label="انسخ الكود"
          icon="copy-outline"
          variant="secondary"
          onPress={() => {
            Clipboard.setStringAsync(code ?? '').catch(() => {});
            setSent(true);
          }}
        />
        <Button label="تمام، حفظته" icon="checkmark-circle-outline" variant="ghost" onPress={close} />
      </View>
    </Sheet>
  );
}

/**
 * Account screen (organizer): see / change the password and make a new recovery code.
 * On this phone it all opens with the fingerprint / face or the phone's lock code.
 */
export function RecoveryCard({ phone }: { phone: string }) {
  const login = { kind: 'admin' as const, phone };
  const [code, setCode] = useState<string | null>(null);
  const [mode, setMode] = useState<'code' | 'change' | null>(null);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const { busy, run } = useAction();

  useEffect(() => {
    hasSavedPassword(login).then(setSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const open = (m: 'code' | 'change') => {
    setPw('');
    setNewPw('');
    setNewPw2('');
    setMode(m);
  };

  /** The current password: from the phone (fingerprint) or typed. */
  const current = async () => (pw ? pw : unlockSavedPassword(login));

  const show = async () => {
    try {
      const p = await unlockSavedPassword(login, 'افتح علشان تشوف الرقم السري');
      alert('الرقم السري بتاعك', `\u2066${p}\u2069`);
    } catch (e) {
      if (e instanceof UnlockError) alert('معلش', e.message);
    }
  };

  const makeCode = async () => {
    const c = await run(async () => {
      const old = await current();
      const next = await renewRecoveryCode(old);
      await rememberPassword(login, old);
      return next;
    });
    if (!c) return;
    setMode(null);
    setCode(c);
  };

  const change = async () => {
    const c = await run(async () => {
      const old = await current();
      const next = await changeAdminPassword(old, newPw);
      await rememberPassword(login, newPw);
      return next;
    });
    if (!c) return;
    setSaved(true);
    setMode(null);
    alert('الرقم السري اتغيّر ✓', 'وكمان طلعلك كود استرجاع جديد، احفظه.');
    setCode(c);
  };

  const needsTyping = !saved;
  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="key-outline" size={22} color={colors.primary} />
        <Text variant="heading" style={{ flex: 1 }}>
          الرقم السري والاسترجاع
        </Text>
      </Row>
      <Text variant="caption">
        {saved
          ? 'نسيت الرقم السري؟ افتح بالبصمة أو قفل الموبايل وشوفه أو غيّره. وكود الاسترجاع بيرجّعلك حسابك من أي موبايل تاني.'
          : 'كود الاسترجاع بيرجّعلك حسابك لو نسيت الرقم السري. لو ضاع منك، اعمل واحد جديد.'}
      </Text>
      {saved ? <Button label="اعرض الرقم السري" icon="finger-print" variant="secondary" onPress={show} /> : null}
      <Row gap={space.sm}>
        <Button label="غيّر الرقم السري" icon="create-outline" variant="secondary" style={{ flex: 1 }} onPress={() => open('change')} />
        <Button label="كود استرجاع جديد" icon="refresh-outline" variant="secondary" style={{ flex: 1 }} onPress={() => open('code')} />
      </Row>
      <Sheet visible={!!mode} title={mode === 'change' ? 'غيّر الرقم السري' : 'كود استرجاع جديد'} onClose={() => setMode(null)}>
        <View style={{ gap: space.md }}>
          {mode === 'code' ? (
            <Text variant="caption">الكود القديم هيبطل يشتغل، والجديد هيظهرلك مرة واحدة بس.</Text>
          ) : null}
          {needsTyping ? (
            <Field label="الرقم السري الحالي" value={pw} onChangeText={setPw} secureTextEntry />
          ) : (
            <Text variant="caption" color={colors.primary} weight="semibold">
              هنطلب البصمة أو قفل الموبايل بدل الرقم السري القديم.
            </Text>
          )}
          {mode === 'change' ? (
            <>
              <Field label="الرقم السري الجديد" value={newPw} onChangeText={setNewPw} secureTextEntry hint="٦ حروف أو أرقام أو أكتر" />
              <Field
                label="اكتبه تاني"
                value={newPw2}
                onChangeText={setNewPw2}
                secureTextEntry
                error={newPw2.length > 0 && newPw2.length >= newPw.length && newPw2 !== newPw ? 'مش زي اللي فوق' : undefined}
              />
              <Button
                label="غيّر"
                icon="checkmark-circle-outline"
                loading={busy}
                disabled={(needsTyping && pw.length < 6) || newPw.length < 6 || newPw !== newPw2}
                onPress={change}
              />
            </>
          ) : (
            <Button label="اعمل الكود" icon="key" loading={busy} disabled={needsTyping && pw.length < 6} onPress={makeCode} />
          )}
        </View>
      </Sheet>
      <RecoveryCodeSheet code={code} phone={phone} onClose={() => setCode(null)} />
    </Card>
  );
}

/** Sign-in screen: number + recovery code + new password. */
export function ForgotPasswordSheet({
  visible,
  initialPhone,
  onClose,
  onDone,
}: {
  visible: boolean;
  initialPhone: string;
  onClose: () => void;
  onDone: (phone: string) => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (visible) setPhone((p) => p || initialPhone);
  }, [visible, initialPhone]);
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ready = !!normalizePhone(phone) && clean.length === 12 && pw.length >= 6 && pw === pw2;

  const submit = async () => {
    const next = await run(async () => {
      const c = await resetPasswordWithCode(phone, clean, pw);
      await rememberPassword({ kind: 'admin', phone }, pw);
      return c;
    });
    if (next) setNewCode(next);
  };

  // Same phone as before: the fingerprint / lock code shows the saved password.
  const [onPhone, setOnPhone] = useState(false);
  useEffect(() => {
    if (visible && normalizePhone(phone)) hasSavedPassword({ kind: 'admin', phone }).then(setOnPhone);
    else setOnPhone(false);
  }, [visible, phone]);
  const fromPhone = async () => {
    try {
      const p = await unlockSavedPassword({ kind: 'admin', phone }, 'افتح علشان تشوف الرقم السري');
      alert('الرقم السري بتاعك', `\u2066${p}\u2069`);
    } catch (e) {
      if (e instanceof UnlockError) alert('معلش', e.message);
    }
  };

  return (
    <>
      <Sheet visible={visible && !newCode} title="نسيت الرقم السري" onClose={onClose}>
        <View style={{ gap: space.md }}>
          {onPhone ? (
            <View style={{ gap: space.sm }}>
              <Button label="افتكره بالبصمة أو قفل الموبايل" icon="finger-print" onPress={fromPhone} />
              <Text variant="caption" center>
                أو بكود الاسترجاع:
              </Text>
            </View>
          ) : null}
          <Text variant="caption">اكتب رقمك وكود الاسترجاع اللي بعتّه لنفسك على واتساب لما عملت الحساب، واختار رقم سري جديد. ولو لسه داخل على موبايلك القديم، افتح صفحة حسابك هناك وغيّره بالبصمة.</Text>
          <Field
            label="رقم الموبايل"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="01xxxxxxxxx"
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          <Field
            label="كود الاسترجاع"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="XXXX-XXXX-XXXX"
            style={{ textAlign: 'left', writingDirection: 'ltr', letterSpacing: 1 }}
          />
          <Field label="الرقم السري الجديد" value={pw} onChangeText={setPw} secureTextEntry hint="٦ حروف أو أرقام أو أكتر" />
          <Field
            label="اكتبه تاني"
            value={pw2}
            onChangeText={setPw2}
            secureTextEntry
            error={pw2.length >= pw.length && pw2.length > 0 && pw2 !== pw ? 'مش زي اللي فوق' : undefined}
          />
          <Button label="غيّر الرقم السري" icon="key" loading={busy} disabled={!ready} onPress={submit} />
          <Text variant="caption" center>
            ٥ محاولات غلط بتقفل الاسترجاع ساعة.
          </Text>
        </View>
      </Sheet>
      <RecoveryCodeSheet
        code={newCode}
        phone={phone}
        onClose={() => {
          setNewCode(null);
          onDone(phone);
        }}
      />
    </>
  );
}
