import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
