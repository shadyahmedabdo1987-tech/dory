import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  useFonts,
} from '@expo-google-fonts/cairo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCircles } from '@/store/circles';
import { colors, fonts } from '@/ui/theme';

// Arabic-first app: lay everything out right-to-left.
if (!I18nManager.isRTL && Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold });
  const hydrated = useCircles((s) => s.hydrated);
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg, direction: 'rtl' },
          animation: 'slide_from_left',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="new" options={{ title: 'جمعية جديدة', presentation: 'modal' }} />
        <Stack.Screen name="circle/[id]" options={{ title: '' }} />
        <Stack.Screen name="circle/edit/[id]" options={{ title: 'تعديل الجمعية', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
