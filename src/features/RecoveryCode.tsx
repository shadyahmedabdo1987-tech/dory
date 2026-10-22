import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { normalizePhone, whatsappUrl } from '@/core';
import { recoveryWhatsappText, renewRecoveryCode, resetPasswordWithCode } from '@/data';
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

/** Account screen: make a new recovery code (the old one stops working). */
export function RecoveryCard({ phone }: { phone: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pw, setPw] = useState('');
  const { busy, run } = useAction();
  const make = async () => {
    const c = await run(() => renewRecoveryCode(pw));
    if (!c) return;
    setAsking(false);
    setPw('');
    setCode(c);
  };
  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="key-outline" size={22} color={colors.primary} />
        <Text variant="heading" style={{ flex: 1 }}>
          كود الاسترجاع
        </Text>
      </Row>
      <Text variant="caption">لو نسيت الرقم السري، الكود ده بيرجّعلك حسابك. لو ضاع منك، اعمل واحد جديد.</Text>
      <Button label="اعمل كود استرجاع جديد" icon="refresh-outline" variant="secondary" onPress={() => setAsking(true)} />
      <Sheet visible={asking} title="كود استرجاع جديد" onClose={() => setAsking(false)}>
        <View style={{ gap: space.md }}>
          <Text variant="caption">الكود القديم هيبطل يشتغل، والجديد هيظهرلك مرة واحدة بس. اكتب الرقم السري بتاعك للتأكيد.</Text>
          <Field label="الرقم السري الحالي" value={pw} onChangeText={setPw} secureTextEntry />
          <Button label="اعمل الكود" icon="key" loading={busy} disabled={pw.length < 6} onPress={make} />
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
      return resetPasswordWithCode(phone, clean, pw);
    });
    if (next) setNewCode(next);
  };

  return (
    <>
      <Sheet visible={visible && !newCode} title="نسيت الرقم السري" onClose={onClose}>
        <View style={{ gap: space.md }}>
          <Text variant="caption">اكتب رقمك وكود الاسترجاع اللي بعتّه لنفسك على واتساب لما عملت الحساب، واختار رقم سري جديد.</Text>
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
