import { File, Paths } from 'expo-file-system';

/**
 * Device preferences that must be known before the first screen is drawn
 * (the colour theme is baked into styles at startup), so they're kept in a
 * small file read synchronously.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

export type Lang = 'ar' | 'en';

export interface Prefs {
  theme?: ThemeMode;
  lang?: Lang;
  /** My own InstaPay (mobile or address) — prefilled when joining / asking for a payout. */
  myInstapay?: string;
  /** My mobile number (the key for signing back in to circles). */
  myPhone?: string;
}

function prefsFile() {
  return new File(Paths.document, 'dory-prefs.json');
}

export function readPrefsSync(): Prefs {
  try {
    const f = prefsFile();
    if (!f.exists) return {};
    return JSON.parse(f.textSync()) as Prefs;
  } catch {
    return {};
  }
}

export function writePrefs(next: Prefs): boolean {
  try {
    const f = prefsFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify({ ...readPrefsSync(), ...next }));
    return true;
  } catch {
    return false;
  }
}
