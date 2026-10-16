import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  formatDate,
  formatMoney,
  METHOD_LABEL,
  PAYOUT_STATUS_LABEL,
  payoutNeedsReceipt,
  payoutNet,
  validatePayoutRequest,
  type Circle,
  type PaymentMethod,
  type PayoutRequest,
  type TimelineEntry,
} from '@/core';
import { decidePayout, markPayoutPaid, requestPayout, undoPayout } from '@/data';
import { Badge, Button, Field, Row, Text } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

import { MethodPicker, ReceiptPicker } from './PaySheet';
import type { PickedReceipt } from './receiptImage';

const ACCOUNT_LABEL: Record<Exclude<PaymentMethod, 'cash'>, { label: string; placeholder: string; keyboard: 'phone-pad' | 'email-address' }> = {
  vodafone_cash: { label: 'رقم فودافون كاش', placeholder: '010xxxxxxxx', keyboard: 'phone-pad' },
  instapay: { label: 'عنوان إنستاباي أو الرقم', placeholder: 'name@instapay', keyboard: 'email-address' },
};

const ACCOUNT_ERROR = {
  'account-missing': 'اكتب الرقم أو العنوان.',
  'account-invalid': 'الرقم أو العنوان مش صحيح.',
} as const;

export const PAYOUT_TONE: Record<PayoutRequest['status'], 'gold' | 'success' | 'danger' | 'neutral'> = {
  requested: 'gold',
  approved: 'neutral',
  rejected: 'danger',
  paid: 'gold',
  received: 'success',
  disputed: 'danger',
};

function AccountField({
  method,
  value,
  onChange,
  showError,
}: {
  method: PaymentMethod;
  value: string;
  onChange: (v: string) => void;
  showError: boolean;
}) {
  if (method === 'cash') return null;
  const meta = ACCOUNT_LABEL[method];
  const problem = validatePayoutRequest(method, value);
  return (
    <Field
      label={meta.label}
      value={value}
      onChangeText={onChange}
      keyboardType={meta.keyboard}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder={meta.placeholder}
      maxLength={60}
      error={showError && problem ? ACCOUNT_ERROR[problem] : undefined}
    />
  );
}

export function describePayout(r: PayoutRequest): string {
  return r.method === 'cash' ? 'كاش' : `${METHOD_LABEL[r.method]} على ${r.account ?? '—'}`;
}

// ---------------------------------------------------------------------------
// Recipient: "how do I want to receive my turn?"
// ---------------------------------------------------------------------------

export function PayoutRequestSheet({
  circle,
  entry,
  request,
  memberId,
  uid,
  onClose,
}: {
  circle: Circle;
  entry: TimelineEntry | null;
  request?: PayoutRequest;
  memberId: string;
  uid: string;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(request?.method ?? 'vodafone_cash');
  const [account, setAccount] = useState(request?.account ?? '');
  const [note, setNote] = useState(request?.note ?? '');
  const [showError, setShowError] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    setMethod(request?.method ?? 'vodafone_cash');
    setAccount(request?.account ?? '');
    setNote(request?.note ?? '');
    setShowError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.period.id]);

  if (!entry) return null;
  const pot = payoutNet(circle);

  const submit = () => {
    if (validatePayoutRequest(method, account)) return setShowError(true);
    run(
      async () => {
        await requestPayout(circle.id, entry.period.id, memberId, uid, { method, account, note });
        onClose();
      },
      { success: 'طلبك وصل لصاحب الجمعية، وهيوصلك رده هنا.' },
    );
  };

  return (
    <Sheet visible title="عايز تقبض إزاي؟" onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          قبضك {formatMoney(pot, circle.currency)} • {formatDate(entry.date)} • من غير ما تدفع قسط الدور ده
        </Text>
        {request?.status === 'rejected' && (
          <View style={styles.notice}>
            <Text color={colors.danger} weight="semibold">
              صاحب الجمعية رفض الطلب اللي فات
            </Text>
            {request.adminNote ? <Text variant="caption">“{request.adminNote}”</Text> : null}
          </View>
        )}
        <MethodPicker value={method} onChange={setMethod} />
        <AccountField method={method} value={account} onChange={setAccount} showError={showError} />
        <Field label="ملاحظة لصاحب الجمعية (اختياري)" value={note} onChangeText={setNote} maxLength={200} />
        <Button label={request ? 'تحديث الطلب' : 'ابعت الطلب'} icon="send" loading={busy} onPress={submit} />
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Admin: approve / reject / edit the request, then pay with a screenshot
// ---------------------------------------------------------------------------

export function AdminPayoutSheet({
  circle,
  entry,
  request,
  uid,
  onClose,
  onShowReceipt,
}: {
  circle: Circle;
  entry: TimelineEntry | null;
  request?: PayoutRequest;
  uid: string;
  onClose: () => void;
  onShowReceipt: (periodId: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(request?.method ?? 'cash');
  const [account, setAccount] = useState(request?.account ?? '');
  const [adminNote, setAdminNote] = useState('');
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const [showError, setShowError] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    setMethod(request?.method ?? 'cash');
    setAccount(request?.account ?? '');
    setAdminNote('');
    setReceipt(null);
    setShowError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.period.id, request?.status]);

  if (!entry) return null;
  const recipient = entry.recipient;
  const pot = payoutNet(circle);
  const paid = !!entry.period.paidOut;
  const edited = !!request && (method !== request.method || (account || '') !== (request.account || ''));
  const needsReceipt = payoutNeedsReceipt(method);

  const decide = (status: 'approved' | 'rejected') => {
    if (!request) return;
    if (status === 'approved' && validatePayoutRequest(method, account)) return setShowError(true);
    run(() => decidePayout(circle.id, request, uid, { status, method, account, adminNote }), {
      success: status === 'approved' ? (edited ? 'اتوافق بعد التعديل.' : 'اتوافق على الطلب.') : 'اترفض الطلب.',
    });
  };

  const pay = async () => {
    if (method !== 'cash' && validatePayoutRequest(method, account)) return setShowError(true);
    if (needsReceipt && !receipt) return Alert.alert('صورة التحويل', 'ارفق صورة التحويل علشان توصل لصاحب الدور.');
    const ok = await confirm(
      'تأكيد تسليم القبض',
      `${formatMoney(pot)} لـ ${recipient?.name ?? ''} — ${method === 'cash' ? 'كاش' : `${METHOD_LABEL[method]} على ${account}`}`,
      'أيوه سلّمت',
    );
    if (!ok || !recipient) return;
    run(
      async () => {
        await markPayoutPaid(circle.id, entry.period.id, recipient.id, uid, {
          method,
          account,
          receiptBase64: receipt?.base64,
          adminNote,
        });
        onClose();
      },
      { success: `اتسجّل إن ${recipient.name} قبض ✓` },
    );
  };

  const undo = async () => {
    if (await confirm('إلغاء التسليم؟', 'القبض هيرجع "لسه ما اتسلّمش"، وصورة التحويل هتتمسح.', 'إلغاء التسليم', true)) {
      run(async () => {
        await undoPayout(circle.id, entry.period.id, !!request?.hasReceipt);
        onClose();
      });
    }
  };

  return (
    <Sheet visible title={`قبض ${recipient?.name ?? ''}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          {formatMoney(pot, circle.currency)} • {formatDate(entry.date)}
        </Text>

        {/* What the recipient asked for */}
        {request ? (
          <View style={styles.requestCard}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text weight="semibold">طلب صاحب الدور</Text>
              <Badge label={PAYOUT_STATUS_LABEL[request.status]} tone={PAYOUT_TONE[request.status]} />
            </Row>
            <Row gap={space.sm}>
              <Text style={{ flex: 1 }}>{describePayout(request)}</Text>
              {request.account ? (
                <Pressable
                  hitSlop={8}
                  accessibilityLabel="نسخ"
                  onPress={() => {
                    Clipboard.setStringAsync(request.account!).catch(() => {});
                    Alert.alert('اتنسخ ✓', request.account);
                  }}
                >
                  <Ionicons name="copy-outline" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
            </Row>
            {request.note ? <Text variant="caption">“{request.note}”</Text> : null}
          </View>
        ) : (
          <Text variant="caption">صاحب الدور لسه ما طلبش طريقة قبض. تقدر تسجّل التسليم بالطريقة اللي اتفقتوا عليها.</Text>
        )}

        {paid ? (
          <>
            <View style={[styles.paidCard, request?.status === 'disputed' && { backgroundColor: colors.dangerSoft }]}>
              <Ionicons
                name={request?.status === 'disputed' ? 'alert-circle' : request?.status === 'received' ? 'shield-checkmark' : 'time-outline'}
                size={22}
                color={request?.status === 'disputed' ? colors.danger : colors.success}
              />
              <View style={{ flex: 1 }}>
                <Text weight="semibold">اتسلّم {request ? `— ${describePayout(request)}` : ''}</Text>
                {request ? <Text variant="caption">{PAYOUT_STATUS_LABEL[request.status]}</Text> : null}
                {request?.status === 'disputed' && request.disputeNote ? (
                  <Text variant="caption" color={colors.danger}>“{request.disputeNote}”</Text>
                ) : null}
              </View>
            </View>
            {request?.hasReceipt && (
              <Button label="عرض صورة التحويل" icon="image-outline" variant="secondary" onPress={() => onShowReceipt(entry.period.id)} />
            )}
            <Button label="إلغاء التسليم" icon="arrow-undo-outline" variant="ghost" onPress={undo} />
          </>
        ) : (
          <>
            <Text weight="semibold">{request ? 'وافق، أو عدّل الطريقة' : 'طريقة التسليم'}</Text>
            <MethodPicker value={method} onChange={setMethod} />
            <AccountField method={method} value={account} onChange={setAccount} showError={showError} />
            <Field label="ملاحظة لصاحب الدور (اختياري)" value={adminNote} onChangeText={setAdminNote} maxLength={200} />

            {request && request.status === 'requested' && (
              <Row gap={space.sm}>
                <Button label="رفض" icon="close" variant="danger" style={{ flex: 1 }} loading={busy} onPress={() => decide('rejected')} />
                <Button
                  label={edited ? 'وافق بالتعديل' : 'موافقة'}
                  icon="checkmark"
                  variant="secondary"
                  style={{ flex: 2 }}
                  loading={busy}
                  onPress={() => decide('approved')}
                />
              </Row>
            )}

            <View style={styles.divider} />
            <Text weight="semibold">حوّلت الفلوس؟</Text>
            {needsReceipt && (
              <>
                <Text variant="caption">ارفق صورة التحويل، وهتوصل لصاحب الدور في حسابه.</Text>
                <ReceiptPicker value={receipt} onChange={setReceipt} />
              </>
            )}
            <Button
              label="سجّل إن القبض اتسلّم"
              icon="cash-outline"
              loading={busy}
              disabled={needsReceipt && !receipt}
              onPress={pay}
            />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}


const styles = StyleSheet.create({
  notice: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, gap: 2 },
  requestCard: { backgroundColor: colors.goldSoft, borderRadius: radius.md, padding: space.md, gap: space.xs },
  paidCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
});
