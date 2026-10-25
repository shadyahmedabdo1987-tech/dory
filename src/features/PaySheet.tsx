import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  checkReceiptText,
  formatDate,
  formatMoney,
  formatNumber,
  parseAmount,
  type ReceiptCheck,
  METHOD_LABEL,
  PAYMENT_METHODS,
  payTarget,
  payAccounts,
  receiptDateOk,
  receiptReference,
  requiresReceipt,
  sha256,
  todayISO,
  type Circle,
  type PaymentMethod,
  type TimelineEntry,
} from '@/core';
import { claimPayments, isReceiptUsed, recordTransferPayment } from '@/data';
import { Button, Field, Row, Text, tap } from '@/ui/components';
import { Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

import { pickReceipt, type PickedReceipt } from './receiptImage';
import { readReceiptText } from './receiptOcr';
import { alert } from '@/ui/dialog';
import { inlineLayers } from '@/ui/layers';

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

/**
 * Admin records a member's InstaPay / Vodafone Cash transfer: the screenshot
 * is required and must show exactly one installment to the admin's account.
 */
export function AdminRecordTransferSheet({
  circle,
  entry,
  member,
  method,
  uid,
  onClose,
}: {
  circle: Circle;
  entry: TimelineEntry | null;
  member: { id: string; name: string } | null;
  method: PaymentMethod;
  uid: string;
  onClose: () => void;
}) {
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const { busy, run } = useAction();
  const target = payTarget(method, circle.payInfo);
  const rc = useReceiptVerification(receipt, entry?.due ?? 0, payAccounts(method, circle.payInfo), { cid: circle.id, due: entry && entry.date > todayISO() ? todayISO() : entry?.date });

  useEffect(() => setReceipt(null), [entry?.period.id, member?.id, method]);

  if (!entry || !member) return null;
  const save = () =>
    receipt &&
    run(
      async () => {
        await recordTransferPayment(circle.id, entry.period.id, member.id, uid, {
          method,
          receiptBase64: receipt.base64,
          receiptCheck: rc.autoOk ? 'auto' : 'manual',
          receiptRef: rc.ref!,
        });
        onClose();
      },
      { success: `اتسجّل دفع ${member.name} ✓` },
    );

  return (
    <Sheet visible title={`${member.name} • ${METHOD_LABEL[method]}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          {formatMoney(entry.due, circle.currency)} • {formatDate(entry.date)}
        </Text>
        <Text weight="semibold">صورة التحويل (مطلوبة)</Text>
        <Text variant="caption">مفيش دفع بإنستاباي أو فودافون كاش بيتسجّل من غير إيصال، ولازم يكون فيه القسط بالظبط على حسابك.</Text>
        <ReceiptPicker value={receipt} onChange={setReceipt} />
        {receipt ? <ReceiptChecks rc={rc} amount={entry.due} target={target} receiverLabel="حسابك" /> : null}
        <Button label="سجّل الدفع" icon="checkmark-done" loading={busy} disabled={!receipt || !rc.verified} onPress={save} />
      </ScrollView>
    </Sheet>
  );
}

/** Member "I paid" flow: pick how you paid; transfers need a screenshot. */
export function PaySheet({
  circle,
  entry,
  memberId,
  uid,
  onClose,
  bundle,
}: {
  circle: Circle;
  entry: TimelineEntry | null;
  memberId: string;
  uid: string;
  onClose: () => void;
  /** Several coming installments paid together (early payment); `entry` is the first. */
  bundle?: TimelineEntry[];
}) {
  const many = bundle && bundle.length > 1 ? bundle : null;
  const total = many ? many.reduce((sum, e) => sum + e.due, 0) : (entry?.due ?? 0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const [note, setNote] = useState('');
  const { busy, run } = useAction();

  // Fresh state every time the sheet opens for a period.
  useEffect(() => {
    setMethod('cash');
    setReceipt(null);
    setNote('');
  }, [entry?.period.id, many?.length]);

  const target = payTarget(method, circle.payInfo);
  const accounts = payAccounts(method, circle.payInfo);
  // One installment, to the admin's InstaPay (number or address) / wallet, recent, never used before.
  const rc = useReceiptVerification(receipt, total, accounts, { cid: circle.id, due: entry && entry.date > todayISO() ? todayISO() : entry?.date });

  if (!entry) return null;
  const needsReceipt = requiresReceipt(method);
  const autoOk = rc.autoOk;
  const verified = !needsReceipt || rc.verified;

  const submit = () =>
    run(
      async () => {
        await claimPayments(circle.id, many ? many.map((e) => e.period.id) : [entry.period.id], memberId, uid, {
          method,
          receiptBase64: needsReceipt ? receipt?.base64 : undefined,
          receiptCheck: needsReceipt ? (autoOk ? 'auto' : 'manual') : undefined,
          receiptRef: needsReceipt ? (rc.ref ?? undefined) : undefined,
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
    <Sheet visible title={many ? 'سداد معجّل' : entry.date > todayISO() ? 'سداد مبكر' : 'دفعت القسط'} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        {many ? (
          <View style={styles.bundle}>
            <Text variant="caption" color={colors.primary} weight="bold">
              {formatNumber(many.length)} قسط مع بعض
            </Text>
            <Text variant="number" color={colors.primary}>
              {formatMoney(total, circle.currency)}
            </Text>
            <Text variant="caption">
              من {formatDate(many[0].date)} لحد {formatDate(many[many.length - 1].date)}
            </Text>
            <Text variant="caption" weight="bold" color={colors.text}>
              هيوصل لصاحب الجمعية كطلب سداد معجّل. أول ما يوافق، كل الأقساط دي تتعلّم مدفوعة مرة واحدة.
            </Text>
          </View>
        ) : (
        <Text variant="caption">
          {formatMoney(entry.due, circle.currency)} • {formatDate(entry.date)}
        </Text>
        )}
        {!many && entry.date > todayISO() ? (
          <Text variant="caption" weight="bold" color={colors.primary}>
            القسط ده لسه ميعاده ما جاش. هيوصل لصاحب الجمعية كطلب سداد مبكر، وأول ما يوافق يتحسب إنك دفعته.
          </Text>
        ) : null}

        <Text weight="semibold">دفعت إزاي؟</Text>
        <MethodPicker value={method} onChange={setMethod} />

        {accounts.map((acc, i) => (
          <Pressable
            key={acc}
            style={styles.target}
            onPress={() => {
              Clipboard.setStringAsync(acc).catch(() => {});
              alert('اتنسخ ✓', acc);
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="caption">{i === 0 ? 'حوّل على' : 'أو على'}</Text>
              <Text weight="bold" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>
                {acc}
              </Text>
            </View>
            <Ionicons name="copy-outline" size={20} color={colors.primary} />
          </Pressable>
        ))}

        {needsReceipt && (
          <View style={{ gap: space.sm }}>
            <Text weight="semibold">صورة التحويل (مطلوبة)</Text>
            <ReceiptPicker value={receipt} onChange={setReceipt} />
            {receipt ? (
              <ReceiptChecks rc={rc} amount={total} target={target} />
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

/**
 * Checks a transfer screenshot: the app reads it and looks for exactly
 * `amount` sent to one of `accounts` (mobile number — also masked — or InstaPay
 * address), dated around the installment, and never used before in the circle
 * (by its transaction reference, or the image itself). If it reads the receipt
 * and anything doesn't match, it's blocked; if it can't read it, the sender
 * types amount + account and they must match (the receiver then double-checks).
 */
export function useReceiptVerification(
  receipt: PickedReceipt | null,
  amount: number,
  accounts: (string | undefined)[],
  opts: { cid?: string; due?: string } = {},
) {
  const [checking, setChecking] = useState(false);
  const [auto, setAuto] = useState<ReceiptCheck | null>(null);
  const [dateOk, setDateOk] = useState<boolean | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [typedAmount, setTypedAmount] = useState('');
  const [typedAccount, setTypedAccount] = useState('');
  const known = accounts.filter((a): a is string => !!a && !!a.trim());
  const key = known.join('|');

  useEffect(() => {
    setAuto(null);
    setDateOk(null);
    setRef(null);
    setDuplicate(false);
    setTypedAmount('');
    setTypedAccount('');
    if (!receipt || !amount) return;
    let cancelled = false;
    setChecking(true);
    (async () => {
      const text = await readReceiptText(receipt.sourceUri ?? receipt.uri).catch(() => null);
      if (cancelled) return;
      // The receipt's fingerprint: its transaction reference, else the image itself.
      const printed = text ? receiptReference(text, { accounts: known }) : null;
      const fingerprint = cleanRef(printed ? `T${printed}` : `I${sha256(`${receipt.base64.length}:${receipt.base64.slice(0, 40_000)}`).slice(0, 40)}`);
      setRef(fingerprint);
      if (opts.cid && (await isReceiptUsed(opts.cid, fingerprint))) {
        if (!cancelled) setDuplicate(true);
      }
      if (cancelled || !text) return;
      const c = checkReceiptText(text, { amount, accounts: known });
      // No saved account to compare with: only the amount can be checked.
      setAuto({ amount: c.amount, account: c.account || known.length === 0 });
      if (opts.due) setDateOk(receiptDateOk(text, opts.due, todayISO()));
    })().finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.uri, amount, key, opts.cid, opts.due]);

  const manual: ReceiptCheck = {
    amount: Math.abs(parseAmount(typedAmount) - amount) < 0.01,
    account: known.length === 0 || checkReceiptText(typedAccount, { amount: 0, accounts: known }).account,
  };
  const autoOk = !!auto && auto.amount && auto.account && dateOk !== false && !duplicate;
  const blocked = duplicate || dateOk === false || (!!auto && !(auto.amount && auto.account));
  const verified = !!receipt && !checking && !!ref && !blocked && (autoOk || (manual.amount && manual.account));
  return {
    checking,
    auto,
    autoOk,
    blocked,
    verified,
    dateOk,
    duplicate,
    ref,
    manual,
    typedAmount,
    setTypedAmount,
    typedAccount,
    setTypedAccount,
  };
}

function cleanRef(raw: string): string {
  const v = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return v.length >= 6 ? v : `${v}000000`.slice(0, 6);
}

export type ReceiptVerification = ReturnType<typeof useReceiptVerification>;

/**
 * Full-screen verdict once the receipt is read: a green check that pops in
 * ("الإيصال صحيح") or a red X with exactly what's wrong.
 */
function ReceiptResult({
  rc,
  amount,
  target,
  receiverLabel,
}: {
  rc: ReceiptVerification;
  amount: number;
  target?: string;
  receiverLabel: string;
}) {
  const verdict: 'ok' | 'bad' | null = rc.checking
    ? null
    : rc.duplicate || rc.dateOk === false || (rc.auto && !(rc.auto.amount && rc.auto.account))
      ? 'bad'
      : rc.autoOk
        ? 'ok'
        : null;
  const key = verdict ? `${rc.ref}:${verdict}` : null;
  const [shown, setShown] = useState<string | null>(null);
  const scale = useRef(new Animated.Value(0)).current;
  const visible = !!key && shown !== key;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
  }, [visible, scale]);

  const ok = verdict === 'ok';
  const reasons: string[] = [];
  if (verdict && !ok) {
    if (rc.duplicate) reasons.push('الإيصال ده اتستخدم قبل كده في الجمعية');
    if (rc.dateOk === false) reasons.push('تاريخ الإيصال قديم — مش بتاع القسط ده');
    if (rc.auto && !rc.auto.amount) reasons.push(`المبلغ المحوّل لازم يكون ${formatMoney(amount)} بالظبط`);
    if (rc.auto && !rc.auto.account) reasons.push(`لازم يكون محوّل على ${target ?? receiverLabel}`);
  }
  // iOS can't stack this popup over the open sheet: show it as the app's dialog instead.
  useEffect(() => {
    if (!inlineLayers || !visible || !verdict) return;
    setShown(key);
    alert(
      ok ? 'الإيصال صحيح ✓' : 'الإيصال مش مطابق',
      ok
        ? `المبلغ ${formatMoney(amount)}\nمحوّل على ${target ?? receiverLabel}\nاتضاف للطلب — دوس "ابعت" علشان يوصل.`
        : `${reasons.map((r) => `✗ ${r}`).join('\n')}\n\nالإيصال مش هيتضاف. ارفع الإيصال الصح.`,
      undefined,
      { tone: ok ? 'success' : 'danger', icon: ok ? 'checkmark-circle' : 'close-circle' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  if (!visible || !verdict || inlineLayers) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShown(key)}>
      <View style={styles.resultBackdrop}>
        <View style={styles.resultCard}>
          <Animated.View
            style={[
              styles.resultIcon,
              { backgroundColor: ok ? colors.success : colors.danger, transform: [{ scale }] },
            ]}
          >
            <Ionicons name={ok ? 'checkmark' : 'close'} size={64} color={colors.white} />
          </Animated.View>
          <Text weight="bold" center style={{ fontSize: 22, lineHeight: 34 }} color={ok ? colors.success : colors.danger}>
            {ok ? 'الإيصال صحيح ✓' : 'الإيصال مش مطابق'}
          </Text>
          {ok ? (
            <View style={{ gap: 4, alignSelf: 'stretch' }}>
              <Text center>المبلغ {formatMoney(amount)}</Text>
              <Text center>محوّل على {target ?? receiverLabel}</Text>
              <Text variant="caption" center>
                اتضاف للطلب — دوس "ابعت" علشان يوصل.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 6, alignSelf: 'stretch' }}>
              {reasons.map((r) => (
                <Row key={r} gap={space.xs}>
                  <Ionicons name="close-circle" size={18} color={colors.danger} />
                  <Text style={{ flex: 1 }}>{r}</Text>
                </Row>
              ))}
              <Text variant="caption" center>
                الإيصال مش هيتضاف. ارفع الإيصال الصح.
              </Text>
            </View>
          )}
          <Button
            label="تمام"
            icon={ok ? 'checkmark' : 'refresh'}
            style={{ alignSelf: 'stretch', ...(ok ? {} : { backgroundColor: colors.danger, borderColor: colors.danger }) }}
            onPress={() => setShown(key)}
          />
        </View>
      </View>
    </Modal>
  );
}

/** Shows whether the screenshot carries exactly the amount, to the right account. */
export function ReceiptChecks({
  rc,
  amount,
  target,
  receiverLabel = 'حساب صاحب الجمعية',
}: {
  rc: ReceiptVerification;
  amount: number;
  target?: string;
  receiverLabel?: string;
}) {
  const { checking, auto, typedAmount, setTypedAmount, typedAccount, setTypedAccount, manual } = rc;
  const result = <ReceiptResult rc={rc} amount={amount} target={target} receiverLabel={receiverLabel} />;
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
  if (rc.duplicate || rc.dateOk === false) {
    return (
      <>
        {result}
        <View style={[styles.check, { backgroundColor: colors.dangerSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
          <Row gap={space.xs}>
            <Ionicons name="close-circle" size={20} color={colors.danger} />
            <Text weight="bold" color={colors.danger} style={{ flex: 1 }}>
              الإيصال مش هيتضاف
            </Text>
          </Row>
          {rc.duplicate ? <Line ok={false} text="الإيصال ده اتستخدم قبل كده في الجمعية" /> : null}
          {rc.dateOk === false ? <Line ok={false} text="تاريخ الإيصال قديم — مش بتاع القسط ده" /> : null}
        </View>
      </>
    );
  }
  if (auto && auto.amount && auto.account) {
    return (
      <>
      {result}
      <View style={[styles.check, { backgroundColor: colors.successSoft }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="bold" color={colors.success}>
            الإيصال مطابق ✓
          </Text>
          <Line ok text={`المبلغ ${formatMoney(amount)}`} />
          <Line ok text={`محوّل على ${target ?? ''}`} />
        </View>
      </View>
      </>
    );
  }
  if (auto) {
    return (
      <>
      {result}
      <View style={[styles.check, { backgroundColor: colors.dangerSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
        <Row gap={space.xs}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
          <Text weight="bold" color={colors.danger} style={{ flex: 1 }}>
            الإيصال مش مطابق — مينفعش يتبعت
          </Text>
        </Row>
        <Line ok={auto.amount} text={auto.amount ? `المبلغ ${formatMoney(amount)}` : `المبلغ المحوّل لازم يكون ${formatMoney(amount)} بالظبط`} />
        <Line ok={auto.account} text={auto.account ? `محوّل على ${target ?? ''}` : `لازم يكون محوّل على ${target ?? receiverLabel}`} />
        <Text variant="caption" color={colors.text}>
          لازم إيصال فيه {formatMoney(amount)} بالظبط على {target ?? receiverLabel}. لو حوّلت مبلغ أقل كمّل الباقي، ولو الصورة مش واضحة صوّرها تاني.
        </Text>
      </View>
      </>
    );
  }
  return (
    <View style={[styles.check, { backgroundColor: colors.goldSoft, flexDirection: 'column', alignItems: 'stretch' }]}>
      <Text weight="bold" color={colors.goldText}>
        مقدرناش نقرا الإيصال كويس
      </Text>
      <Text variant="caption">
        اكتب المبلغ والرقم اللي حوّلت عليه زي ما هما في الإيصال، ولازم يطابقوا {formatMoney(amount)} و{target ?? receiverLabel}. والفلوس مش هتتحسب غير لما المستلم يتأكد إنها وصلت حسابه.
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
        error={typedAccount && !manual.account ? `ده مش ${receiverLabel}` : undefined}
      />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  resultBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: space.xl },
  resultCard: { width: '100%', maxWidth: 380, backgroundColor: colors.card, borderRadius: radius.lg, padding: space.xl, gap: space.md, alignItems: 'center' },
  resultIcon: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
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
  bundle: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
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
