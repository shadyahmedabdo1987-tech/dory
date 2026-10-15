export const colors = {
  primary: '#0F5C4D',
  primaryDark: '#0A4238',
  primarySoft: '#E3EFEB',
  gold: '#C9A23F',
  goldSoft: '#F7EFD9',
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
  white: '#FFFFFF',
} as const;

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
