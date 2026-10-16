import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addMonths,
  daysInMonth,
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  monthName,
  moveItem,
  newId,
  normalizePayAccount,
  ordinal,
  parseAmount,
  parseISODate,
  todayISO,
  toISODate,
  validateDraft,
  type CircleDraft,
  type DraftError,
  type Frequency,
  type Member,
} from '@/core';
import { Button, Card, Chip, Field, IconButton, Row, Segmented, Text } from '@/ui/components';
import { colors, fonts, radius, space } from '@/ui/theme';

import { DrawWheel } from './DrawWheel';
import { alert } from '@/ui/dialog';

const ERRORS: Record<DraftError, string> = {
  name: 'اكتب اسم للجمعية',
  installment: 'اكتب قيمة القسط',
  startDate: 'التاريخ مش صحيح',
  members: 'محتاج عضو واحد على الأقل',
  slots: 'عدد الأعضاء لازم يكون من ٢ لـ ١٢٠، ومش أقل من الأعضاء الموجودين',
  memberName: 'في عضو من غير اسم',
  duplicatePhone: 'في رقم أو إيميل إنستاباي متكرر لعضوين',
};

const blankMember = (): Member => ({ id: newId('new_'), name: '', phone: '' });

/**
 * Create mode: member order is the payout order (with a draw button).
 * Edit mode: the roster only — turn order is managed from the schedule tab.
 */
export function CircleForm({
  mode,
  initial,
  ownerName,
  submitLabel,
  busy,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: CircleDraft;
  /** Organizer's name, used for their own row when they take the first turn. */
  ownerName?: string;
  submitLabel: string;
  busy?: boolean;
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
    // Create: only the organizer — everyone else asks to join from the app.
    initial?.members ?? [{ ...blankMember(), name: ownerName?.trim() || '' }],
  );
  const [slotsText, setSlotsText] = useState(initial?.slots ? String(initial.slots) : mode === 'create' ? '10' : '');
  // The organizer is the first row and keeps the first turn; the draw covers everyone else.
  const [ownerFirst, setOwnerFirst] = useState(mode === 'create');
  const locked = (i: number) => mode === 'create' && ownerFirst && i === 0;
  const [showErrors, setShowErrors] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);

  const months = useMemo(() => {
    const list: { key: string; y: number; m: number }[] = [];
    const base = `${today.slice(0, 8)}01`;
    for (let i = -1; i < 12; i++) {
      const { y, m } = parseISODate(addMonths(base, i));
      list.push({ key: `${y}-${m}`, y, m });
    }
    if (!list.some((x) => x.key === `${start.y}-${start.m}`)) list.unshift({ key: `${start.y}-${start.m}`, y: start.y, m: start.m });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = months.find((x) => x.key === monthKey) ?? months[1];
  const dayNum = Math.max(1, Math.min(parseAmount(day) || 1, daysInMonth(selected.y, selected.m)));
  const startDate = toISODate({ y: selected.y, m: selected.m, d: dayNum });
  const installment = parseAmount(amount);
  const slots = slotsText.trim() ? Math.round(parseAmount(slotsText)) : undefined;
  const draft: CircleDraft = {
    name,
    installment,
    frequency,
    startDate,
    members,
    ownerFirst: mode === 'create' && ownerFirst,
    ...(slots !== undefined ? { slots } : {}),
  };
  const errors = validateDraft(draft, normalizePayAccount);
  const has = (e: DraftError) => showErrors && errors.includes(e);

  const update = (id: string, patch: Partial<Member>) =>
    setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const remove = (m: Member) => {
    const doRemove = () => setMembers((list) => list.filter((x) => x.id !== m.id));
    if (mode === 'edit' && !m.id.startsWith('new_')) {
      alert('حذف العضو؟', `هيتشال "${m.name}" ودوره في القبض. مدفوعاته القديمة مش هتظهر.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'احذف', style: 'destructive', icon: 'trash', onPress: doRemove },
      ]);
    } else doRemove();
  };

  const submit = () => {
    if (errors.length) {
      setShowErrors(true);
      alert('ناقص شوية بيانات', errors.map((e) => `• ${ERRORS[e]}`).join('\n'));
      return;
    }
    onSubmit({ ...draft, members: members.map((m) => ({ ...m, name: m.name.trim() })) });
  };

  const size = mode === 'create' ? (slots ?? members.length) : Math.max(members.length, slots ?? 0);
  const pot = Number.isFinite(installment) ? installment * size : 0;
  const thisYear = Number(today.slice(0, 4));

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
            maxLength={60}
            error={has('name') ? ERRORS.name : undefined}
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
            <Text weight="semibold">ميعاد الدفع</Text>
            <Segmented
              value={frequency}
              onChange={setFrequency}
              options={[
                { value: 'monthly', label: 'شهري' },
                { value: 'quarterly', label: '٣ شهور' },
                { value: 'every4months', label: '٤ شهور' },
                { value: 'weekly', label: 'أسبوعي' },
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
                label={mo.y === thisYear ? monthName(mo.m) : `${monthName(mo.m)} ${formatNumber(mo.y).replace(/[٬,]/g, '')}`}
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
          {mode === 'edit' && (
            <Text variant="caption" color={colors.danger}>
              تغيير الميعاد بيحرّك مواعيد كل الأدوار.
            </Text>
          )}
        </Card>

        <Card>
          <Text variant="heading">عدد الأعضاء</Text>
          <Field
            label="عدد الأعضاء المطلوب (معاك إنت)"
            value={slotsText}
            onChangeText={setSlotsText}
            keyboardType="number-pad"
            maxLength={3}
            error={has('slots') ? ERRORS.slots : undefined}
            hint={
              mode === 'create'
                ? 'بعد ما تعمل الجمعية، هتبعت كود الدعوة لأرقام الأعضاء برسالة SMS أو واتساب. كل واحد بيبعت طلب باسمه وإنستاباي بتاعه، وإنت بتوافق أو ترفض.'
                : `دلوقتي فيها ${formatNumber(members.length)} عضو.`
            }
          />
        </Card>

        {mode === 'create' && (
          <Card>
            <Text variant="heading">بياناتك كصاحب الجمعية</Text>
            <View style={[styles.ownerToggle, { backgroundColor: colors.goldSoft }]}>
              <Text>👑</Text>
              <View style={{ flex: 1 }}>
                <Text weight="semibold">{members[0]?.name || 'إنت'} — الدور الأول</Text>
                <Text variant="caption">إنت بتقبض الأول، والقرعة بتكون على باقي الأعضاء بعد ما يدخلوا.</Text>
              </View>
            </View>
            <TextInput
              placeholder="اسمك"
              placeholderTextColor={colors.muted}
              value={members[0]?.name ?? ''}
              maxLength={60}
              onChangeText={(t) => members[0] && update(members[0].id, { name: t })}
              style={[styles.input, has('memberName') && { borderColor: colors.danger }]}
            />
            <TextInput
              placeholder="إنستاباي: رقم الموبايل أو الإيميل (اختياري)"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={members[0]?.phone ?? ''}
              onChangeText={(t) => members[0] && update(members[0].id, { phone: t })}
              style={[styles.input, !!members[0]?.phone && !normalizePayAccount(members[0].phone) && { borderColor: colors.danger }]}
            />
          </Card>
        )}

        {mode === 'edit' && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">{mode === 'create' ? 'الأعضاء وترتيب القبض' : 'الأعضاء'}</Text>
            <Text variant="caption">{formatNumber(members.length)} عضو</Text>
          </Row>
          <Text variant="caption">
            {mode === 'create'
              ? 'الترتيب هنا هو ترتيب القبض. الأعضاء بيبعتوا طلبات انضمام وإنت بتوافق عليهم من التطبيق. خانة إنستاباي اختيارية للقبض بس: اكتب رقم الموبايل المتوصل بإنستاباي أو إيميل إنستاباي (زي name@instapay).'
              : 'الأعضاء الجداد بيتضاف دورهم في آخر الجدول. ترتيب الأدوار من تبويب "الجدول".'}
          </Text>
          {mode === 'create' && (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: ownerFirst }}
              onPress={() => setOwnerFirst((v) => !v)}
              style={styles.ownerToggle}
            >
              <Ionicons name={ownerFirst ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text weight="semibold">صاحب الجمعية ياخد الدور الأول</Text>
                <Text variant="caption">الصف الأول هو إنت، والقرعة بتكون على باقي الأعضاء.</Text>
              </View>
            </Pressable>
          )}
          {has('members') && <Text variant="caption" color={colors.danger}>{ERRORS.members}</Text>}
          {has('duplicatePhone') && <Text variant="caption" color={colors.danger}>{ERRORS.duplicatePhone}</Text>}

          {members.map((m, i) => (
            <View key={m.id} style={styles.member}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={space.xs} style={{ flexShrink: 1 }}>
                  {mode === 'create' ? (
                    <View style={[styles.pill, locked(i) && { backgroundColor: colors.goldSoft }]}>
                      <Text variant="caption" weight="bold" color={locked(i) ? '#8A6A1C' : colors.primary}>
                        {locked(i) ? '👑 صاحب الجمعية • الدور الأول' : `الدور ${ordinal(i)}`}
                      </Text>
                    </View>
                  ) : m.uid ? (
                    <Row gap={4}>
                      <Ionicons name="phone-portrait-outline" size={14} color={colors.success} />
                      <Text variant="caption" color={colors.success}>
                        داخل من موبايله
                      </Text>
                    </Row>
                  ) : null}
                </Row>
                <Row gap={space.xs}>
                  {mode === 'create' && !locked(i) && (
                    <>
                      <IconButton
                        icon="arrow-up"
                        label="لفوق"
                        disabled={i === 0 || locked(i) || locked(i - 1)}
                        onPress={() => setMembers((l) => moveItem(l, i, i - 1))}
                      />
                      <IconButton
                        icon="arrow-down"
                        label="لتحت"
                        disabled={i === members.length - 1 || locked(i)}
                        onPress={() => setMembers((l) => moveItem(l, i, i + 1))}
                      />
                    </>
                  )}
                  {!locked(i) && (
                    <IconButton icon="trash-outline" label="حذف" color={colors.danger} bg={colors.dangerSoft} onPress={() => remove(m)} />
                  )}
                </Row>
              </Row>
              <TextInput
                placeholder="الاسم"
                placeholderTextColor={colors.muted}
                value={m.name}
                maxLength={60}
                onChangeText={(t) => update(m.id, { name: t })}
                style={[styles.input, showErrors && !m.name.trim() && { borderColor: colors.danger }]}
              />
              <TextInput
                placeholder="إنستاباي: رقم الموبايل أو الإيميل (اختياري)"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={m.phone ?? ''}
                onChangeText={(t) => update(m.id, { phone: t })}
                style={[styles.input, !!m.phone && !normalizePayAccount(m.phone) && { borderColor: colors.danger }]}
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
            {mode === 'create' && (
              <Button
                label="عجلة القرعة"
                icon="sync-circle-outline"
                variant="secondary"
                style={{ flex: 1 }}
                disabled={members.length < 2}
                onPress={() => {
                  if (members.some((m) => !m.name.trim())) {
                    setShowErrors(true);
                    return alert('اكتب الأسماء الأول', 'كل عضو لازم يكون ليه اسم قبل القرعة.');
                  }
                  setWheelOpen(true);
                }}
              />
            )}
          </Row>
        </Card>
        )}

        <View style={styles.summary}>
          <Text color={colors.white} center>
            كل عضو يدفع {Number.isFinite(installment) ? formatMoney(installment) : '—'} {FREQUENCY_LABEL[frequency].every}، ويقبض
          </Text>
          <Text variant="number" color={colors.gold}>
            {formatMoney(pot)}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.75)">
            على {formatNumber(size)} {FREQUENCY_LABEL[frequency].units}
          </Text>
        </View>

        <Button label={submitLabel} icon="checkmark-circle" loading={busy} onPress={submit} />
      </ScrollView>
      <DrawWheel
        visible={wheelOpen}
        entries={members.slice(ownerFirst && mode === 'create' ? 1 : 0).map((m) => ({ key: m.id, value: m.id, name: m.name.trim() }))}
        title={ownerFirst && mode === 'create' ? 'قرعة باقي الأعضاء' : undefined}
        onClose={() => setWheelOpen(false)}
        onDone={(ids) => {
          const byId = new Map(members.map((m) => [m.id, m]));
          const drawn = ids.map((id) => byId.get(id)!).filter(Boolean);
          setMembers(ownerFirst && mode === 'create' ? [members[0], ...drawn] : drawn);
          setWheelOpen(false);
        }}
      />
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
  ownerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  pill: { backgroundColor: colors.primarySoft, paddingHorizontal: space.md, paddingVertical: 2, borderRadius: radius.pill },
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
  summary: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: space.xs },
});
