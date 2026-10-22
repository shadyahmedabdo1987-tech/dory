import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text, tap } from './components';
import { Sheet } from './feedback';
import { colors, radius, space } from './theme';

export type SelectOption<T extends string | number> = { value: T; label: string; sub?: string };

/**
 * Drop-down: shows the chosen option; tapping opens the full list to pick from.
 * Used for every one-of-many choice in the app.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = 'اختار…',
  title,
}: {
  label?: string;
  value: T | null | undefined;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text weight="semibold">{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? title ?? placeholder}
        onPress={() => {
          tap();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.field, pressed && { borderColor: colors.primary }]}
      >
        <View style={{ flex: 1 }}>
          <Text weight={chosen ? 'bold' : 'regular'} color={chosen ? colors.text : colors.muted} numberOfLines={1}>
            {chosen ? chosen.label : placeholder}
          </Text>
          {chosen?.sub ? (
            <Text variant="caption" numberOfLines={1}>
              {chosen.sub}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={20} color={colors.primary} />
      </Pressable>
      <Sheet visible={open} title={title ?? label ?? placeholder} onClose={() => setOpen(false)}>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.xs, paddingBottom: space.md }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={String(o.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  tap();
                  setOpen(false);
                  onChange(o.value);
                }}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.8 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text weight="bold" color={on ? colors.primary : colors.text}>
                    {o.label}
                  </Text>
                  {o.sub ? <Text variant="caption">{o.sub}</Text> : null}
                </View>
                {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});

/**
 * Drop-down for picking several (e.g. members — even 100 of them): shows who's chosen;
 * tapping opens the list with a search box, "select all" and a tick per name.
 */
export function MultiSelect<T extends string | number>({
  label,
  values,
  options,
  onChange,
  placeholder = 'اختار…',
  title,
}: {
  label?: string;
  values: T[];
  options: SelectOption<T>[];
  onChange: (v: T[]) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = options.filter((o) => values.includes(o.value));
  const shown = q.trim() ? options.filter((o) => o.label.includes(q.trim())) : options;
  const all = options.length > 0 && chosen.length === options.length;
  const summary =
    chosen.length === 0
      ? placeholder
      : all && options.length > 1
        ? `الكل (${options.length})`
        : chosen.length <= 2
          ? chosen.map((o) => o.label).join('، ')
          : `${chosen.slice(0, 2).map((o) => o.label).join('، ')} و${chosen.length - 2} كمان`;
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text weight="semibold">{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? title ?? placeholder}
        onPress={() => {
          tap();
          setQ('');
          setOpen(true);
        }}
        style={({ pressed }) => [styles.field, pressed && { borderColor: colors.primary }]}
      >
        <View style={{ flex: 1 }}>
          <Text weight={chosen.length ? 'bold' : 'regular'} color={chosen.length ? colors.text : colors.muted} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {chosen.length ? (
          <View style={multiStyles.count}>
            <Text weight="bold" color={colors.white} style={{ fontSize: 13, lineHeight: 18 }}>
              {chosen.length}
            </Text>
          </View>
        ) : null}
        <Ionicons name="chevron-down" size={20} color={colors.primary} />
      </Pressable>
      <Sheet visible={open} title={title ?? label ?? placeholder} onClose={() => setOpen(false)}>
        <View style={{ gap: space.sm, flexShrink: 1 }}>
          {options.length > 8 ? (
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="دوّر بالاسم…"
              placeholderTextColor={colors.muted}
              style={multiStyles.search}
            />
          ) : null}
          {options.length > 1 ? (
            <Text weight="bold" color={colors.primary} onPress={() => onChange(all ? [] : options.map((o) => o.value))}>
              {all ? 'شيل الكل' : 'اختار الكل'}
            </Text>
          ) : null}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.xs, paddingBottom: space.sm }} keyboardShouldPersistTaps="handled">
            {shown.map((o) => {
              const on = values.includes(o.value);
              return (
                <Pressable
                  key={String(o.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    tap();
                    toggle(o.value);
                  }}
                  style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.primary : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text weight="bold" color={on ? colors.primary : colors.text}>
                      {o.label}
                    </Text>
                    {o.sub ? <Text variant="caption">{o.sub}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {shown.length === 0 ? <Text variant="caption" center>مفيش اسم كده.</Text> : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={({ pressed }) => [multiStyles.done, pressed && { opacity: 0.85 }]}
          >
            <Text weight="bold" color={colors.white}>
              تمام{chosen.length ? ` (${chosen.length})` : ''}
            </Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const multiStyles = StyleSheet.create({
  count: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  search: {
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 16,
    textAlign: 'right',
  },
  done: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
});
