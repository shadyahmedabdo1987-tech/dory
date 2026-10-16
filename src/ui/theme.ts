import { Appearance } from 'react-native';

import { readPrefsSync, type ThemeMode } from './prefs';

const light = {
  primary: '#0F5C4D',
  primaryDark: '#0A4238',
  primarySoft: '#E3EFEB',
  gold: '#C9A23F',
  goldSoft: '#F7EFD9',
  /** Gold-toned text on goldSoft. */
  goldText: '#8A6A1C',
  orange: '#E8730C',
  orangeSoft: '#FFF1E3',
  bg: '#F6F3EC',
  card: '#FFFFFF',
  text: '#1B2420',
  muted: '#6B7570',
  border: '#E6E1D6',
  success: '#2E8B57',
  successSoft: '#E4F3EA',
  danger: '#C2410C',
  dangerSoft: '#FCEBE2',
  whatsapp: '#25D366',
  /** Always white: text and icons on coloured fills. */
  white: '#FFFFFF',
};

export type Palette = typeof light;

const dark: Palette = {
  primary: '#13705D',
  primaryDark: '#0B4A3E',
  primarySoft: '#173A32',
  gold: '#D4AF4F',
  goldSoft: '#3A3220',
  goldText: '#E9CB7A',
  orange: '#F08A2E',
  orangeSoft: '#3D2A18',
  bg: '#0E1513',
  card: '#18211E',
  text: '#E9EFEC',
  muted: '#9AA7A2',
  border: '#2A3632',
  success: '#4CC08A',
  successSoft: '#17382A',
  danger: '#F07A4A',
  dangerSoft: '#3D2219',
  whatsapp: '#25D366',
  white: '#FFFFFF',
};

/** Chosen in "حسابي"; applied when the app starts. */
export const themeMode: ThemeMode = readPrefsSync().theme ?? 'light';
export const isDark = themeMode === 'dark' || (themeMode === 'system' && Appearance.getColorScheme() === 'dark');

export const colors: Palette = isDark ? dark : light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const fonts = {
  regular: 'Cairo_400Regular',
  semibold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
} as const;

export const shadow = {
  shadowColor: '#0F5C4D',
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
