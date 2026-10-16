import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ComponentProps } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  checkReceiptText,
  formatDate,
  formatMoney,
  parseAmount,
  type ReceiptCheck,
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
import { readReceiptText } from './receiptOcr';
import { alert } from '@/ui/dialog';

/** Brand-ish accent per payment method (cash green, InstaPay purple, Vodafone red). */
export const METHOD_COLOR: Record<PaymentMethod, string> = {
  cash: '#2E8B57',
  instapay: '#5B2D90',
  vodafone_cash: '#E60000',
};

export const METHOD_ICON: Record<PaymentMethod, ComponentProps<typeof Ionicons>['name']> = {
  cash: 'cash-outline',
  instapay: 'flash-outline',
  vodafone_cash: 'phone-portrait-outline',
};

export function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <Row gap={space.sm}>
      {PAYMENT_METHODS.map((m) => {
        const active = m === value;
        const accent = METHOD_COLOR[m];
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => {
              tap();
              onChange(m);
            }}
            style={({ pressed }) => [
              styles.method,
              active && { borderColor: accent, backgroundColor: `${accent}0F` },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            {active ? (
              <View style={[styles.methodCheck, { backgroundColor: accent }]}>
                <Ionicons name="checkmark" size={12} color={colors.white} />
              </View>
            ) : null}
            <View style={[styles.methodIcon, { backgroundColor: `${accent}1A` }]}>
              <Ionicons name={METHOD_ICON[m]} size={22} color={accent} />
            </View>
            <Text variant="caption" weight="bold" color={active ? accent : colors.text}>
              {METHOD_LABEL[m]}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** A preview of a picked screenshot with a "change" action, or library/camera buttons. */
export function ReceiptPicker({
  value,
  onChange,
}: {
  value: PickedReceipt | null;
  onChange: (r: PickedReceipt | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const choose = async (source: 'library' | 'camera') => {
    setPicking(true);
    try {
      const picked = await pickReceipt(source);
      if (picked) onChange(picked);
    } catch {
      alert('معلش', 'مقدرناش نفتح الصورة. جرّب تاني.');
    } finally {
      setPicking(false);
    }
  };
  return value ? (
    <View style={styles.previewWrap}>
      <Image source={{ uri: value.uri }} style={styles.preview} resizeMode="contain" />
      <Button label="غيّر الصورة" icon="refresh" variant="ghost" onPress={() => onChange(null)} />
    </View>
  ) : (
    <Row gap={space.sm}>
      <Button label="من الصور" icon="images-outline" variant="secondary" style={{ flex: 1 }} loading={picking} onPress={() => choose('library')} />
      <Button label="صوّر" icon="camera-outline" variant="secondary" style={{ flex: 1 }} disabled={picking} onPress={() => choose('camera')} />
    </Row>
  );
}

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
  const { busy, run } = useAction();
  // Receipt check: automatic from the image, or typed by the member if it can't be read.
  const [checking, setChecking] = useState(false);
  const [auto, setAuto] = useState<ReceiptCheck | null>(null);
  const [typedAmount, setTypedAmount] = useState('');
  const [typedAccount, setTypedAccount] = useState('');

  // Fresh state every time the sheet opens for a period.
  useEffect(() => {
    setMethod('cash');
    setReceipt(null);
    setNote('');
  }, [entry?.period.id]);

  useEffect(() => {
    setAuto(null);
    setTypedAmount('');
    setTypedAccount('');
    if (!receipt || !entry) return;
    let cancelled = false;
    setChecking(true);
    readReceiptText(receipt.sourceUri ?? receipt.uri)
      .then((text) => {
        if (cancelled) return;
        if (!text) return setAuto(null);
        const to = payTarget(method, circle.payInfo);
        const c = checkReceiptText(text, { amount: entry.due, accounts: [to] });
        // If the admin hasn't saved an account for this method, only the amount can be checked.
        setAuto({ amount: c.amount, account: c.account || !to });
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.uri, method]);

  if (!entry) return null;
  const needsReceipt = requiresReceipt(method);
  const target = payTarget(method, circle.payInfo);

  // Typed fallback must match too: one installment, to the admin's account.
  const manual: ReceiptCheck = {
    amount: Math.abs(parseAmount(typedAmount) - entry.due) < 0.01,
    account: !target || checkReceiptText(typedAccount, { amount: 0, accounts: [target] }).account,
  };
  const autoOk = !!auto && auto.amount && auto.account;
  // The app read the receipt and it doesn't match: no way around it — the right receipt (right amount, right account) is needed.
  const blocked = !!auto && !autoOk;
  const verified = !needsReceipt || (!!receipt && !checking && !blocked && (autoOk || (manual.amount && manual.account)));

  const submit = () =>
    run(
      async () => {
        await claimPayment(circle.id, entry.period.id, memberId, uid, {
          method,
          receiptBase64: needsReceipt ? receipt?.base64 : undefined,
          receiptCheck: needsReceipt ? (autoOk ? 'auto' : 'manual') : undefined,
          note,
        });
        onClose();
      },
      {
        success:
          needsReceipt && !autoOk
            ? 'وصل لصاحب الجمعية. هيأكد الدفع بعد ما يتأكد إن الفلوس وصلت حسابه.'
            : 'وصل لصاحب الجمعية، ومستني تأكيده.',
      },
    );

  return (
    <Sheet visible title="دفعت القسط" onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          {formatMoney(entry.due, circle.currency)} • {formatDate(entry.date)}
        </Text>

        <Text weight="semibold">دفعت إزاي؟</Text>
        <MethodPicker value={method} onChange={setMethod} />

        {target && (
          <Pressable
            style={styles.target}
            onPress={() => {
              Clipboard.setStringAsync(target).catch(() => {});
              alert('اتنسخ ✓', target);
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
            <ReceiptPicker value={receipt} onChange={setReceipt} />
            {receipt ? (
              <ReceiptChecks
                checking={checking}
                auto={auto}
                amount={entry.due}
                target={target}
                typedAmount={typedAmount}
                setTypedAmount={setTypedAmount}
                typedAccount={typedAccount}
                setTypedAccount={setTypedAccount}
                manual={manual}
              />
            ) : null}
          </View>
        )}

        <Field label="ملاحظة (اختياري)" value={note} onChangeText={setNote} maxLength={200} placeholder="مثلًا: رقم العملية" />

        <Button
          label="ابعت لصاحب الجمعية"
          icon="send"
          loading={busy}
          disabled={!verified}
          onPress={submit}
        />
      </ScrollView>
    </Sheet>
  );
}

/** Shows whether the screenshot goes to the admin's account with exactly one installment. */
function ReceiptChecks({
  checking,
  auto,
  amount,
  target,
  typedAmount,
  setTypedAmount,
  typedAccount,
  setTypedAccount,
  manual,
}: {
  checking: boolean;
  auto: ReceiptCheck | null;
  amount: number;
  target?: string;
  typedAmount: string;
  setTypedAmount: (v: string) => void;
  typedAccount: string;
  setTypedAccount: (v: string) => void;
  manual: ReceiptCheck;
}) {
  if (checking) {
    return (
      <View style={[styles.check, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="scan-outline" size={20} color={colors.primary} />
        <Text style={{ flex: 1 }}>بنراجع الإيصال…</Text>
      </View>
    );
  }
  const Line = ({ ok, text }: { ok: boolean; text: string }) => (
    <Row gap={space.xs}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={18} color={ok ? colors.success : colors.danger} />
      <Text style={{ flex: 1 }} color={ok ? colors.success : colors.danger}>
        {text}
      </Text>
    </Row>
  );
  if (auto && auto.amount && auto.account) {
    return (
      <View style={[styles.check, { backgroundColor: colors.successSoft }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="bold" color={colors.success}>
            الإيصال مطابق ✓
          </Text>
          <Line ok text={`المبلغ ${formatMoney(amount)}`} />
          <Line ok text={`محوّل على ${target ?? ''}`} />
        </View>
      </View>
    );
  }
  if (auto) {
    return (
      <View style={[styles.check, { backgroundColor: colors.dangerSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
        <Row gap={space.xs}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
          <Text weight="bold" color={colors.danger} style={{ flex: 1 }}>
            الإيصال مش مطابق — مينفعش يتبعت
          </Text>
        </Row>
        <Line ok={auto.amount} text={auto.amount ? `المبلغ ${formatMoney(amount)}` : `المبلغ المحوّل لازم يكون ${formatMoney(amount)} بالظبط`} />
        <Line ok={auto.account} text={auto.account ? `محوّل على ${target ?? ''}` : `لازم يكون محوّل على ${target ?? 'حساب صاحب الجمعية'}`} />
        <Text variant="caption" color={colors.text}>
          لو حوّلت مبلغ أقل كمّل الباقي، وبعدين ارفع صورة إيصال فيها قيمة القسط كاملة على حساب صاحب الجمعية. ولو الصورة مش واضحة، صوّرها تاني.
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.check, { backgroundColor: colors.goldSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
      <Text weight="bold" color={colors.goldText}>
        مقدرناش نقرا الإيصال كويس
      </Text>
      <Text variant="caption">
        اكتب المبلغ والرقم اللي حوّلت عليه زي ما هما في الإيصال، ولازم يطابقوا قيمة القسط وحساب صاحب الجمعية. الدفع مش هيتحسب غير لما صاحب الجمعية يتأكد إن الفلوس وصلت حسابه.
      </Text>
      <Field
        label="المبلغ اللي حوّلته"
        value={typedAmount}
        onChangeText={setTypedAmount}
        keyboardType="numeric"
        placeholder={String(amount)}
        error={typedAmount && !manual.amount ? `لازم يكون ${formatMoney(amount)}` : undefined}
      />
      {target ? (
      <Field
        label="حوّلت على"
        value={typedAccount}
        onChangeText={setTypedAccount}
        autoCapitalize="none"
        placeholder={target ?? ''}
        error={typedAccount && !manual.account ? 'ده مش حساب صاحب الجمعية' : undefined}
      />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  method: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  methodIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  methodCheck: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
