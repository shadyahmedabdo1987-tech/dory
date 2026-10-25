import { Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, useFonts } from '@expo-google-fonts/cairo';
import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { isFirebaseConfigured, useSession } from '@/data';
import { SessionProvider } from '@/data/session';
import { useNotificationRouting } from '@/notifications';
import { BusyHost } from '@/ui/busy';
import { DialogHost } from '@/ui/dialog';
import { ErrorScreen } from '@/ui/feedback';
import { IntroSplash } from '@/ui/IntroSplash';
import { AppLock } from '@/ui/AppLock';
import { AppHeader, type AppHeaderProps } from '@/ui/AppHeader';
import { colors, fonts } from '@/ui/theme';
import { isEn, tr } from '@/i18n';

// iOS: a native modal screen can't show our dialogs on top of it (the confirm never appears and
// the screen looks frozen, e.g. sign-out), so there these screens slide in as regular pages.
const SHEET = Platform.OS === 'ios' ? ('card' as const) : ('modal' as const);

// Arabic: right-to-left; English: left-to-right (takes effect from the next launch).
if (Platform.OS !== 'web' && I18nManager.isRTL === isEn) {
  I18nManager.allowRTL(!isEn);
  I18nManager.forceRTL(!isEn);
}

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Last line of defence: if a screen ever throws, show a way back instead of a blank page or a crash.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <ErrorScreen
      message="حصلت مشكلة في الشاشة دي. دوس «جرّب تاني» وهترجع للبداية."
      onRetry={() => {
        try {
          if (router.canDismiss()) router.dismissAll();
          router.replace('/');
        } catch {
          // fall through to retry
        }
        retry();
      }}
    />
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold });
  const session = useSession();
  useNotificationRouting();
  const ready = fontsLoaded && !session.loading;

  const [intro, setIntro] = useState(true);
  const endIntro = useCallback(() => setIntro(false), []);
  // The animated intro takes over from the native splash the moment it's on screen.
  const hideNative = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    if (ready && !intro) SplashScreen.hideAsync().catch(() => {});
  }, [ready, intro]);

  const introLayer = intro ? <IntroSplash ready={ready} onShown={hideNative} onDone={endIntro} /> : null;

  // The intro stays mounted in the same place throughout, so its animation never restarts.
  return (
    <>
      {ready ? <App session={session} /> : null}
      {introLayer}
    </>
  );
}

function App({ session }: { session: ReturnType<typeof useSession> }) {
  if (!isFirebaseConfigured) {
    return <ErrorScreen message="التطبيق مش متوصل بالسيرفر. لو إنت المطوّر: انسخ ‎.env.example‎ لـ ‎.env‎ وحط مفاتيح Firebase." />;
  }

  return (
    <SessionProvider value={session}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.white,
            headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18 },
            headerShadowVisible: false,
            // iOS: just the back arrow, never the previous screen's route name.
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.bg },
            // iOS: our own header (the system back button could stop responding — screen stuck).
            ...(Platform.OS === 'ios' ? { header: (p: unknown) => <AppHeader {...(p as AppHeaderProps)} /> } : {}),
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ title: tr('حساب صاحب الجمعية'), presentation: SHEET }} />
          <Stack.Screen name="account" options={{ title: tr('حسابي'), presentation: SHEET }} />
          <Stack.Screen name="join" options={{ title: tr('كود الدعوة'), presentation: SHEET }} />
          <Stack.Screen name="new" options={{ title: tr('جمعية جديدة'), presentation: SHEET }} />
          <Stack.Screen name="circle/[id]" options={{ title: '' }} />
          <Stack.Screen name="circle/settings/[id]" options={{ title: tr('إعدادات الجمعية'), presentation: SHEET }} />
        </Stack>
        <BusyHost />
        <AppLock />
        <DialogHost />
      </SafeAreaProvider>
    </SessionProvider>
  );
}
