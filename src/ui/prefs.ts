import { File, Paths } from 'expo-file-system';

/**
 * Device preferences that must be known before the first screen is drawn
 * (the colour theme is baked into styles at startup), so they're kept in a
 * small file read synchronously.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Prefs {
  theme?: ThemeMode;
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
