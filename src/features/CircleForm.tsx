import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addMonths,
  daysInMonth,
  drawTurns,
  formatDate,
  formatMoney,
  formatNumber,
  moveItem,
  ordinalTurn,
  parseISODate,
  todayISO,
  toISODate,
  validateDraft,
  type CircleDraft,
  type DraftError,
  type Frequency,
  type Member,
} from '@/core';
import { newId } from '@/store/circles';
import { Button, Card, Chip, Field, IconButton, Row, Segmented, Text } from '@/ui/components';
import { colors, fonts, radius, space } from '@/ui/theme';

const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const ERRORS: Record<DraftError, string> = {
  name: 'اكتب اسم للجمعية',
  installment: 'اكتب قيمة القسط',
  startDate: 'التاريخ مش صحيح',
  members: 'محتاج عضوين على الأقل',
  memberName: 'في عضو من غير اسم',
};

/** Accepts Arabic-Indic digits and thousands separators. */
function parseAmount(text: string): number {
  const ascii = text.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[^\d.]/g, '');
  return ascii ? Number(ascii) : NaN;
}

function blankMember(): Member {
  return { id: newId(), name: '', phone: '' };
}

export function CircleForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: CircleDraft;
  submitLabel: string;
  onSubmit: (draft: CircleDraft) => void;
}) {
  const insets = useSafeAreaInsets();
  const today = todayISO();
  const start = parseISODate(initial?.startDate ?? today);

  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.installment) : '');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [monthKey, setMonthKey] = useState(`${start.y}-${start.m}`);
  const [day, setDay] = useState(String(start.d));
  const [members, setMembers] = useState<Member[]>(
    initial?.members ?? [blankMember(), blankMember(), blankMember()],
  );
  const [showErrors, setShowErrors] = useState(false);

  // Next 12 months (plus the initial month when editing an older circle).
  const months = useMemo(() => {
    const list: { key: string; y: number; m: number }[] = [];
    const base = today.slice(0, 8) + '01';
    for (let i = 0; i < 12; i++) {
      const { y, m } = parseISODate(addMonths(base, i));
      list.push({ key: `${y}-${m}`, y, m });
    }
    if (!list.some((x) => x.key === `${start.y}-${start.m}`)) {
      list.unshift({ key: `${start.y}-${start.m}`, y: start.y, m: start.m });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMonth = months.find((x) => x.key === monthKey) ?? months[0];
  const dayNum = Math.max(1, Math.min(Number(parseAmount(day)) || 1, daysInMonth(selectedMonth.y, selectedMonth.m)));
  const startDate = toISODate({ y: selectedMonth.y, m: selectedMonth.m, d: dayNum });
  const installment = parseAmount(amount);

  const draft: CircleDraft = { name, installment, frequency, startDate, members };
  const errors = validateDraft(draft);
  const has = (e: DraftError) => showErrors && errors.includes(e);

  const updateMember = (id: string, patch: Partial<Member>) =>
    setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const removeMember = (id: string) => setMembers((list) => list.filter((m) => m.id !== id));

  const draw = () => {
    if (members.length < 2) return;
    setMembers((list) => drawTurns(list));
  };

  const submit = () => {
    if (errors.length) {
      setShowErrors(true);
      Alert.alert('ناقص شوية بيانات', errors.map((e) => `• ${ERRORS[e]}`).join('\n'));
      return;
    }
    onSubmit(draft);
  };

  const pot = Number.isFinite(installment) ? installment * members.length : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}
      >
        <Card>
          <Text variant="heading">البيانات الأساسية</Text>
          <Field
            label="اسم الجمعية"
            placeholder="مثلًا: جمعية الشغل"
            value={name}
            onChangeText={setName}
            error={has('name') ? ERRORS.name : undefined}
            returnKeyType="next"
          />
          <Field
            label="القسط اللي بيدفعه كل عضو"
            placeholder="1000"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            error={has('installment') ? ERRORS.installment : undefined}
            hint="بالجنيه المصري"
          />
          <View style={{ gap: space.xs }}>
            <Text weight="semibold">كل قد إيه؟</Text>
            <Segmented
              value={frequency}
              onChange={setFrequency}
              options={[
                { value: 'monthly', label: 'كل شهر' },
                { value: 'weekly', label: 'كل أسبوع' },
              ]}
            />
          </View>
        </Card>

        <Card>
          <Text variant="heading">ميعاد أول قسط</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {months.map((mo) => (
              <Chip
                key={mo.key}
                label={
                  mo.y === Number(today.slice(0, 4))
                    ? MONTH_NAMES[mo.m - 1]
                    : `${MONTH_NAMES[mo.m - 1]} ${formatNumber(mo.y).replace(/[٬,]/g, '')}`
                }
                active={mo.key === monthKey}
                onPress={() => setMonthKey(mo.key)}
              />
            ))}
          </ScrollView>
          <Row gap={space.md}>
            <Text weight="semibold">يوم</Text>
            <TextInput
              value={day}
              onChangeText={setDay}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.dayInput}
              accessibilityLabel="يوم القسط"
            />
            <Text variant="caption" style={{ flex: 1 }}>
              أول قسط: {formatDate(startDate)}
            </Text>
          </Row>
        </Card>

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">الأعضاء وترتيب القبض</Text>
            <Text variant="caption">{formatNumber(members.length)} عضو</Text>
          </Row>
          <Text variant="caption">
            الترتيب هنا هو ترتيب القبض. رتّب بالأسهم أو اعمل قرعة عشوائية.
          </Text>
          {has('members') && <Text variant="caption" color={colors.danger}>{ERRORS.members}</Text>}

          {members.map((m, i) => (
            <View key={m.id} style={styles.member}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={styles.turnPill}>
                  <Text variant="caption" weight="bold" color={colors.primary}>
                    الدور {ordinalTurn(i)}
                  </Text>
                </View>
                <Row gap={space.xs}>
                  <IconButton icon="arrow-up" label="لفوق" disabled={i === 0} onPress={() => setMembers((l) => moveItem(l, i, i - 1))} />
                  <IconButton
                    icon="arrow-down"
                    label="لتحت"
                    disabled={i === members.length - 1}
                    onPress={() => setMembers((l) => moveItem(l, i, i + 1))}
                  />
                  <IconButton
                    icon="trash-outline"
                    label="حذف"
                    color={colors.danger}
                    bg={colors.dangerSoft}
                    onPress={() => removeMember(m.id)}
                  />
                </Row>
              </Row>
              <TextInput
                placeholder="الاسم"
                placeholderTextColor={colors.muted}
                value={m.name}
                onChangeText={(t) => updateMember(m.id, { name: t })}
                style={[styles.input, showErrors && !m.name.trim() && { borderColor: colors.danger }]}
              />
              <TextInput
                placeholder="رقم الموبايل (للتذكير على واتساب)"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                value={m.phone ?? ''}
                onChangeText={(t) => updateMember(m.id, { phone: t })}
                style={styles.input}
              />
            </View>
          ))}

          <Row gap={space.sm}>
            <Button
              label="ضيف عضو"
              icon="person-add-outline"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => setMembers((l) => [...l, blankMember()])}
            />
            <Button
              label="قرعة"
              icon="shuffle"
              variant="secondary"
              style={{ flex: 1 }}
              disabled={members.length < 2}
              onPress={draw}
            />
          </Row>
        </Card>

        <View style={styles.summary}>
          <Text color={colors.white}>
            كل عضو يدفع {Number.isFinite(installment) ? formatMoney(installment) : '—'} ويقبض
          </Text>
          <Text variant="number" color={colors.gold}>
            {formatMoney(pot)}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.75)">
            على {formatNumber(members.length)} {frequency === 'monthly' ? 'شهور' : 'أسابيع'}
          </Text>
        </View>

        <Button label={submitLabel} icon="checkmark-circle" onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  member: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  turnPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: space.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  input: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
    textAlign: 'right',
  },
  dayInput: {
    width: 64,
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.text,
  },
  summary: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
});
