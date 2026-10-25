import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { I18nManager, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './components';
import { colors, fonts, space } from './theme';

/**
 * iPhone header drawn by the app itself. The system header's back button could stop
 * responding on newer iOS (the screen looked frozen with no way out), so on iOS every
 * pushed screen gets this one: a plain, always-tappable back arrow.
 */
export interface AppHeaderProps {
  navigation: { canGoBack: () => boolean; goBack: () => void };
  options: { title?: string; headerRight?: (p: { tintColor?: string; canGoBack: boolean }) => ReactNode };
  back?: unknown;
  route: { name: string };
}

export function AppHeader({ navigation, options, back, route }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const title = typeof options.title === 'string' ? options.title : route.name;
  const right = options.headerRight?.({ tintColor: colors.white, canGoBack: !!back });
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {back ? (
            <Pressable
              onPress={goBack}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="رجوع"
              testID="header-back"
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.white} />
            </Pressable>
          ) : null}
        </View>
        <Text numberOfLines={1} color={colors.white} style={styles.title}>
          {title}
        </Text>
        <View style={[styles.side, styles.sideEnd]}>{right ?? null}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.primary },
  row: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  side: { minWidth: 56, flexDirection: 'row', alignItems: 'center' },
  sideEnd: { justifyContent: 'flex-end', paddingHorizontal: space.sm },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.bold, fontSize: 18, lineHeight: 28 },
});
