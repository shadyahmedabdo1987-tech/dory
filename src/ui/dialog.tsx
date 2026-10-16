import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from './components';
import { colors, fonts, radius, space } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Branded replacement for `Alert.alert`: light, rounded, RTL, with colored
 * buttons. Same call shape as `Alert.alert(title, message, buttons)`, plus
 * optional `icon`/`color`/`hint` per button and `icon`/`tone` per dialog.
 */
export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
  /** Shows the button as an option row with this icon. */
  icon?: IconName;
  /** Accent color for an option row (e.g. a payment brand color). */
  color?: string;
  /** Small second line under an option row. */
  hint?: string;
}

export type DialogTone = 'info' | 'success' | 'warning' | 'danger' | 'question';

export interface DialogOptions {
  icon?: IconName;
  tone?: DialogTone;
}

interface DialogRequest extends DialogOptions {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let nextId = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<(q: DialogRequest[]) => void>();
const emit = () => listeners.forEach((l) => l(queue));

export function alert(title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) {
  queue = [...queue, { id: nextId++, title, message, buttons: buttons?.length ? buttons : [{ text: 'تمام' }], ...options }];
  emit();
}

const TONES: Record<DialogTone, { icon: IconName; fg: string; bg: string }> = {
  info: { icon: 'information-circle', fg: colors.primary, bg: colors.primarySoft },
  success: { icon: 'checkmark-circle', fg: colors.success, bg: colors.successSoft },
  warning: { icon: 'alert-circle', fg: '#B7791F', bg: colors.goldSoft },
  danger: { icon: 'trash', fg: colors.danger, bg: colors.dangerSoft },
  question: { icon: 'help-circle', fg: colors.primary, bg: colors.primarySoft },
};

function guessTone(d: DialogRequest): DialogTone {
  if (d.tone) return d.tone;
  if (d.buttons.some((b) => b.style === 'destructive')) return 'danger';
  if (d.title.includes('✓')) return 'success';
  if (/معلش|مش متاح|ناقص|كبيرة|محتاج|مينفعش/.test(d.title)) return 'warning';
  if (d.buttons.some((b) => b.icon) || d.buttons.length > 1) return 'question';
  return 'info';
}

/** Mount once at the app root. */
export function DialogHost() {
  const [items, setItems] = useState<DialogRequest[]>(queue);
  const current = items[0];
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [current?.id]);

  const close = (button?: DialogButton) => {
    if (!current) return;
    queue = queue.filter((d) => d.id !== current.id);
    emit();
    // Let the dialog unmount before the action opens anything else.
    if (button?.onPress) setTimeout(button.onPress, 60);
  };

  const cancelButton = current?.buttons.find((b) => b.style === 'cancel');
  const dismiss = () => close(cancelButton ?? (current?.buttons.length === 1 ? current.buttons[0] : undefined));

  if (!current) return null;

  const tone = TONES[guessTone(current)];
  const icon = current.icon ?? tone.icon;
  const actions = current.buttons.filter((b) => b !== cancelButton);
  // Many choices (or choices with explanations) → a tappable list; otherwise buttons.
  const asOptions = actions.length > 2 || actions.some((b) => b.hint);
  const ordered = [...actions].sort((a, b) => Number(a.style === 'destructive') - Number(b.style === 'destructive'));

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancelButton ? dismiss : undefined} accessibilityLabel="إغلاق" />
        <Animated.View
          style={[
            styles.card,
            { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Ionicons name={icon} size={30} color={tone.fg} />
          </View>
          <Text weight="bold" center style={styles.title}>
            {current.title}
          </Text>
          {current.message ? (
            <Text center color={colors.muted} style={styles.message}>
              {current.message}
            </Text>
          ) : null}

          <ScrollView style={{ alignSelf: 'stretch', maxHeight: 360 }} contentContainerStyle={{ gap: space.sm }} bounces={false}>
            {asOptions ? (
              actions.map((b) => <OptionRow key={b.text} button={b} onPress={() => close(b)} />)
            ) : (
              <View style={[styles.actionsRow, actions.length + (cancelButton ? 1 : 0) === 2 ? null : styles.actionsColumn]}>
                {ordered.map((b) => (
                  <DialogAction key={b.text} button={b} onPress={() => close(b)} />
                ))}
                {cancelButton ? <DialogAction button={cancelButton} onPress={() => close(cancelButton)} /> : null}
              </View>
            )}
          </ScrollView>
          {asOptions && cancelButton ? (
            <Pressable onPress={() => close(cancelButton)} style={({ pressed }) => [styles.cancelLink, pressed && { opacity: 0.6 }]}>
              <Text weight="semibold" color={colors.muted}>
                {cancelButton.text}
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function tapFeedback() {
  Haptics.selectionAsync().catch(() => {});
}

/** Two-button style: filled primary / red destructive / outlined cancel. */
function DialogAction({ button, onPress }: { button: DialogButton; onPress: () => void }) {
  const kind = button.style === 'cancel' ? 'cancel' : button.style === 'destructive' ? 'danger' : 'primary';
  const v = {
    primary: { bg: button.color ?? colors.primary, fg: colors.white, border: button.color ?? colors.primary },
    danger: { bg: colors.danger, fg: colors.white, border: colors.danger },
    cancel: { bg: colors.card, fg: colors.text, border: colors.border },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.text}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
      ]}
    >
      {button.icon ? <Ionicons name={button.icon} size={18} color={v.fg} /> : null}
      <Text weight="bold" color={v.fg} numberOfLines={1}>
        {button.text}
      </Text>
    </Pressable>
  );
}

/** List style: icon tile in the accent color, label, optional hint, chevron. */
function OptionRow({ button, onPress }: { button: DialogButton; onPress: () => void }) {
  const accent = button.style === 'destructive' ? colors.danger : (button.color ?? colors.primary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={button.text}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: `${accent}12`, borderColor: accent }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons name={button.icon ?? 'ellipse-outline'} size={22} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="bold" color={button.style === 'destructive' ? colors.danger : colors.text}>
          {button.text}
        </Text>
        {button.hint ? <Text variant="caption">{button.hint}</Text> : null}
      </View>
      <Ionicons name="chevron-back" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 32, 28, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radius.lg + 6,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    alignItems: 'center',
    gap: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  badge: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  title: { fontSize: 19, lineHeight: 30, fontFamily: fonts.bold },
  message: { lineHeight: 24, marginBottom: space.sm },
  actionsRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  actionsColumn: { flexDirection: 'column' },
  action: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  optionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cancelLink: { paddingVertical: space.sm, paddingHorizontal: space.xl, marginTop: space.xs },
});
