import { Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, useFonts } from '@expo-google-fonts/cairo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { isFirebaseConfigured, useSession } from '@/data';
import { SessionProvider } from '@/data/session';
import { useNotificationRouting } from '@/notifications';
import { BusyHost } from '@/ui/busy';
import { DialogHost } from '@/ui/dialog';
import { ErrorScreen } from '@/ui/feedback';
import { colors, fonts } from '@/ui/theme';

// Arabic-first app: lay everything out right-to-left.
if (!I18nManager.isRTL && Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold });
  const session = useSession();
  useNotificationRouting();
  const ready = fontsLoaded && !session.loading;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

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
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ title: 'حساب صاحب الجمعية', presentation: 'modal' }} />
          <Stack.Screen name="account" options={{ title: 'حسابي', presentation: 'modal' }} />
          <Stack.Screen name="join" options={{ title: 'كود الدعوة', presentation: 'modal' }} />
          <Stack.Screen name="new" options={{ title: 'جمعية جديدة', presentation: 'modal' }} />
          <Stack.Screen name="circle/[id]" options={{ title: '' }} />
          <Stack.Screen name="circle/settings/[id]" options={{ title: 'إعدادات الجمعية', presentation: 'modal' }} />
        </Stack>
        <BusyHost />
        <DialogHost />
      </SafeAreaProvider>
    </SessionProvider>
  );
}
