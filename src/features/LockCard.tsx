import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { askBiometric, biometricAvailable, clearLock, hashPin, lockSettings, PIN_LENGTH, saveLock, setLockBio } from '@/ui/AppLock';
import { Badge, Button, Card, Field, Row, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { Sheet } from '@/ui/feedback';
import { colors, space } from '@/ui/theme';

const digitsOnly = (t: string) =>
  t.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '').slice(0, PIN_LENGTH);

/** Account screen: lock the app with the fingerprint / face or a 4-digit code. */
export function LockCard() {
  const [settings, setSettings] = useState(lockSettings());
  const [bio, setBio] = useState<{ ok: boolean; face: boolean }>({ ok: false, face: false });
  const [mode, setMode] = useState<'set' | 'off' | null>(null);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');

  useEffect(() => {
    biometricAvailable().then(setBio);
  }, []);
  const refresh = () => setSettings(lockSettings());
  const bioName = bio.face ? 'بصمة الوش' : 'البصمة';

  const open = (m: 'set' | 'off') => {
    setCurrent('');
    setPin('');
    setPin2('');
    setMode(m);
  };

  const checkCurrent = () => !settings || hashPin(current) === settings.pin;

  const save = () => {
    if (!checkCurrent()) return alert('الرقم السري الحالي مش صح');
    if (pin.length !== PIN_LENGTH || pin !== pin2) return alert(`اكتب ${PIN_LENGTH} أرقام، ونفسهم مرتين`);
    saveLock(pin, settings ? settings.bio : bio.ok);
    setMode(null);
    refresh();
    alert('قفل التطبيق شغّال ✓', bio.ok ? `هيتفتح بـ${bioName} أو الرقم السري.` : 'هيتفتح بالرقم السري.');
  };

  const turnOff = () => {
    if (!checkCurrent()) return alert('الرقم السري مش صح');
    clearLock();
    setMode(null);
    refresh();
  };

  const toggleBio = async () => {
    if (!settings) return;
    if (!settings.bio && !(await askBiometric(`شغّل ${bioName}`))) return;
    setLockBio(!settings.bio);
    refresh();
  };

  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="lock-closed-outline" size={22} color={colors.primary} />
        <Text variant="heading" style={{ flex: 1 }}>
          قفل التطبيق
        </Text>
        {settings ? <Badge label="شغّال ✓" tone="success" /> : null}
      </Row>
      <Text variant="caption">
        {settings
          ? 'دوري بيتقفل كل ما تفتحه، ومحدش يفتحه غيرك.'
          : `اقفل دوري ${bio.ok ? `بـ${bioName} أو ` : 'بـ'}رقم سري من ${PIN_LENGTH} أرقام، علشان محدش يشوف جمعياتك وفلوسك لو مسك موبايلك.`}
      </Text>
      {settings ? (
        <View style={{ gap: space.sm }}>
          {bio.ok ? (
            <Button
              label={settings.bio ? `${bioName}: شغّالة ✓` : `شغّل ${bioName}`}
              icon={bio.face ? 'scan-outline' : 'finger-print'}
              variant="secondary"
              onPress={toggleBio}
            />
          ) : null}
          <Row gap={space.sm}>
            <Button label="غيّر الرقم السري" icon="keypad-outline" variant="secondary" style={{ flex: 1 }} onPress={() => open('set')} />
            <Button label="وقّف القفل" icon="lock-open-outline" variant="danger" style={{ flex: 1 }} onPress={() => open('off')} />
          </Row>
        </View>
      ) : (
        <Button label="شغّل قفل التطبيق" icon="lock-closed" onPress={() => open('set')} />
      )}

      <Sheet visible={!!mode} title={mode === 'off' ? 'وقّف قفل التطبيق' : settings ? 'غيّر الرقم السري' : 'اختار رقم سري'} onClose={() => setMode(null)}>
        <View style={{ gap: space.md }}>
          {settings ? (
            <Field
              label="الرقم السري الحالي"
              value={current}
              onChangeText={(t) => setCurrent(digitsOnly(t))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_LENGTH}
              placeholder="••••"
            />
          ) : null}
          {mode === 'set' ? (
            <>
              <Field
                label={`رقم سري جديد (${PIN_LENGTH} أرقام)`}
                value={pin}
                onChangeText={(t) => setPin(digitsOnly(t))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_LENGTH}
                placeholder="••••"
              />
              <Field
                label="اكتبه تاني"
                value={pin2}
                onChangeText={(t) => setPin2(digitsOnly(t))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_LENGTH}
                placeholder="••••"
                error={pin2.length === PIN_LENGTH && pin2 !== pin ? 'مش زي اللي فوق' : undefined}
              />
              <Button label="حفظ" icon="checkmark-circle-outline" disabled={pin.length !== PIN_LENGTH || pin !== pin2} onPress={save} />
            </>
          ) : (
            <Button label="وقّف القفل" icon="lock-open-outline" variant="danger" disabled={current.length !== PIN_LENGTH} onPress={turnOff} />
          )}
          <Text variant="caption" center>
            لو نسيت الرقم السري: امسح بيانات التطبيق من إعدادات الموبايل وادخل تاني.
          </Text>
        </View>
      </Sheet>
    </Card>
  );
}
