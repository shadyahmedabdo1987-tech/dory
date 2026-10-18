import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { isEn, tr, trNode } from '@/i18n';

import { colors, fonts, radius, shadow, space } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function tap() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

type Weight = keyof typeof fonts;
type Variant = 'title' | 'heading' | 'body' | 'caption' | 'number';

const variants: Record<Variant, TextStyle> = {
  title: { fontSize: 26, lineHeight: 40 },
  heading: { fontSize: 18, lineHeight: 30 },
  body: { fontSize: 15, lineHeight: 24 },
  caption: { fontSize: 13, lineHeight: 20, color: colors.muted },
  number: { fontSize: 30, lineHeight: 44 },
};

export function Text({
  variant = 'body',
  weight,
  color,
  center,
  style,
  ...rest
}: TextProps & { variant?: Variant; weight?: Weight; color?: string; center?: boolean }) {
  const resolvedWeight: Weight =
    weight ?? (variant === 'title' || variant === 'number' ? 'bold' : variant === 'heading' ? 'semibold' : 'regular');
  return (
    <RNText
      maxFontSizeMultiplier={1.15}
      {...rest}
      style={[
        styles.text,
        variants[variant],
        { fontFamily: fonts[resolvedWeight] },
        color ? { color } : null,
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {trNode(rest.children)}
    </RNText>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({
  children,
  gap = space.sm,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function ProgressBar({ value, color = colors.gold }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.fill, { width: `${pct}%` as `${number}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' | 'gold' }) {
  const palette = {
    neutral: [colors.primarySoft, colors.primary],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    gold: [colors.goldSoft, colors.goldText],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette[0] }]}>
      <Text variant="caption" weight="semibold" color={palette[1]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
  singleLine,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Keep the label on one line, shrinking it slightly if it must. */
  singleLine?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr(label)}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={v.fg} /> : null}
          <Text
            weight="bold"
            color={v.fg}
            numberOfLines={singleLine ? 1 : 2}
            adjustsFontSizeToFit={singleLine}
            minimumFontScale={0.8}
            style={{ flexShrink: 1, textAlign: 'center' }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
  whatsapp: { bg: colors.whatsapp, fg: colors.white, border: colors.whatsapp },
} as const;

export function IconButton({
  icon,
  onPress,
  label,
  color = colors.primary,
  bg = colors.primarySoft,
  disabled,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  bg?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: bg },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  style,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text weight="semibold">{label}</Text>
      <TextInput
        maxFontSizeMultiplier={1.15}
        placeholderTextColor={colors.muted}
        {...input}
        // Fields start empty (the label says what goes in them) — except InstaPay
        // fields, where an example of the number / address format helps.
        placeholder={input.placeholder && /instapay|إنستاباي|فودافون/i.test(`${label} ${input.placeholder}`) ? tr(input.placeholder) : undefined}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
      />
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              weight={active ? 'bold' : 'semibold'}
              color={active ? colors.white : colors.text}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              maxFontSizeMultiplier={1}
              style={styles.segmentText}
            >
              {o.label}
            </Text>
            {o.badge ? (
              <View style={[styles.segmentBadge, active && { backgroundColor: colors.gold }]}>
                <Text weight="bold" color={colors.white} maxFontSizeMultiplier={1} style={{ fontSize: 11, lineHeight: 16 }}>
                  {o.badge > 99 ? '99+' : o.badge.toLocaleString('ar-EG')}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text variant="caption" weight={active ? 'bold' : 'semibold'} color={active ? colors.white : colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={44} color={colors.gold} />
      </View>
      <Text variant="heading" center>
        {title}
      </Text>
      <Text center color={colors.muted}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.text, writingDirection: isEn ? 'ltr' : 'rtl', textAlign: 'left' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  badge: { paddingHorizontal: space.sm + 2, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  iconButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  input: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    textAlign: isEn ? 'left' : 'right',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  segmentText: { fontSize: 14, lineHeight: 22, flexShrink: 1, textAlign: 'center' },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.primary },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
});
