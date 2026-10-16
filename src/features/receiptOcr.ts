/**
 * Reads the text on a transfer screenshot on the phone itself (Google ML Kit,
 * offline). Returns null when the reader isn't available on this build/device,
 * in which case the member confirms the amount and account by hand.
 */
export async function readReceiptText(uri: string): Promise<string | null> {
  try {
    // Loaded lazily so a build without the native module still runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-ml-kit/text-recognition');
    const TextRecognition = mod.default ?? mod;
    const result = await TextRecognition.recognize(uri);
    const text: string = result?.text ?? '';
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}
