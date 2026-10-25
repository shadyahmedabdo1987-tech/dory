import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the stack header under the status bar (Android/iOS default). */
const HEADER = 56;

/**
 * Lifts the screen above the keyboard so the field being typed in stays
 * visible. The app is edge-to-edge on Android, where the OS no longer resizes
 * the window, so this has to be done on both platforms.
 */
export function KeyboardScreen({
  children,
  header = true,
  style,
}: {
  children: ReactNode;
  /** The screen sits under a navigation header (offset by its height). */
  header?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior="padding"
      // iOS measures this view's position on the whole screen, so the header is already counted
      // (adding it again left an empty band above the keyboard).
      keyboardVerticalOffset={header && Platform.OS !== 'ios' ? insets.top + HEADER : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
