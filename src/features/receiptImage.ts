import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { MAX_RECEIPT_BASE64 } from '@/core';
import { alert } from '@/ui/dialog';

export interface PickedReceipt {
  uri: string;
  base64: string;
}

/** Progressive compression so screenshots fit comfortably in a Firestore document. */
const PASSES = [
  { width: 1080, compress: 0.6 },
  { width: 860, compress: 0.45 },
  { width: 680, compress: 0.35 },
];

async function compress(uri: string, sourceWidth: number): Promise<PickedReceipt | null> {
  for (const pass of PASSES) {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      sourceWidth > pass.width ? [{ resize: { width: pass.width } }] : [],
      { compress: pass.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (result.base64 && result.base64.length <= MAX_RECEIPT_BASE64) {
      return { uri: result.uri, base64: result.base64 };
    }
  }
  return null;
}

export async function pickReceipt(source: 'library' | 'camera'): Promise<PickedReceipt | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      alert('محتاجين إذن الكاميرا', 'علشان تصوّر إيصال التحويل، اسمح للتطبيق باستخدام الكاميرا من الإعدادات.', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'الإعدادات', onPress: () => Linking.openSettings() },
      ]);
      return null;
    }
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const picked =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets?.[0]) return null;

  const asset = picked.assets[0];
  const result = await compress(asset.uri, asset.width ?? 2000);
  if (!result) alert('الصورة كبيرة جدًا', 'جرّب تقص الصورة على جزء التحويل بس.');
  return result;
}
