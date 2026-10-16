import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, I18nManager, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatNumber, normalizePayAccount } from '@/core';
import { changeMyEmail, myAdminInstapay, releaseMyMemberships, setInstapayForMyCircles, signOut, updateMyName, useMyCircles } from '@/data';
import { useAppSession } from '@/data/session';
import { clearReminders, unregisterPush } from '@/notifications';
import { Badge, Button, Card, Field, Row, Segmented, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { confirm, useAction } from '@/ui/feedback';
import { KeyboardScreen } from '@/ui/KeyboardScreen';
import { readPrefsSync, writePrefs, type Lang, type ThemeMode } from '@/ui/prefs';
import { lang as currentLang } from '@/i18n';
import { colors, radius, space, themeMode } from '@/ui/theme';

/** "حسابي": personal details, appearance, notifications and sign-out — for admins and members. */
export default function Account() {
  const insets = useSafeAreaInsets();
  const { user, isAccount, refresh } = useAppSession();
  const { refs } = useMyCircles(user?.uid);
  const { busy, run } = useAction();

  const [name, setName] = useState(user?.displayName ?? '');
  const [theme, setTheme] = useState<ThemeMode>(themeMode);
  const [language, setLanguage] = useState<Lang>(currentLang);
  const [notif, setNotif] = useState<'on' | 'off' | 'unknown'>('unknown');
  const [instapay, setInstapay] = useState(() => readPrefsSync().myInstapay ?? '');
  const [savedInstapay, setSavedInstapay] = useState(instapay);
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');

  // Admins: show the account their circles already use.
  useEffect(() => {
    if (!isAccount || !user || instapay) return;
    myAdminInstapay(user.uid).then((v) => {
      if (v) {
        setInstapay(v);
        setSavedInstapay(v);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAccount, user?.uid]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.getPermissionsAsync()
      .then((p) => setNotif(p.granted ? 'on' : 'off'))
      .catch(() => setNotif('unknown'));
  }, []);

  if (!user) return null;

  const admin = refs?.filter((r) => r.role === 'admin').length ?? 0;
  const member = refs?.filter((r) => r.role === 'member').length ?? 0;
  const shownName = user.displayName?.trim() || (isAccount ? 'صاحب جمعية' : 'عضو');
  const nameChanged = name.trim() !== (user.displayName ?? '').trim();

  const saveName = () =>
    run(
      async () => {
        if (!name.trim()) throw new Error('اكتب اسمك.');
        await updateMyName(name);
        refresh?.();
      },
      { success: 'الاسم اتحفظ ✓' },
    );

  const instapayBad = !!instapay.trim() && !normalizePayAccount(instapay);
  const saveInstapay = () =>
    run(
      async () => {
        const v = instapay.trim();
        if (v && !normalizePayAccount(v)) throw new Error('اكتب رقم موبايل متوصل بإنستاباي أو عنوان إنستاباي زي name@instapay.');
        writePrefs({ myInstapay: v });
        let n = 0;
        if (isAccount && v) n = await setInstapayForMyCircles(user.uid, v);
        setSavedInstapay(v);
        return n;
      },
      {
        success: isAccount
          ? 'اتحفظ ✓ — الأعضاء هيحوّلوا على الحساب ده في كل جمعياتك، والإيصالات هتتراجع عليه.'
          : 'اتحفظ ✓ — هيتكتب لوحده لما تطلب القبض.',
      },
    );

  const emailBad = !!newEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail.trim());
  const saveEmail = () =>
    run(
      async () => {
        if (!newEmail.trim() || emailBad) throw new Error('اكتب إيميل صحيح.');
        if (!password) throw new Error('اكتب الباسورد الحالي علشان نتأكد إنه إنت.');
        await changeMyEmail(newEmail, password);
        setEmailOpen(false);
        setPassword('');
      },
      { success: `بعتنا رابط تأكيد على ${newEmail.trim()}. افتحه من الإيميل الجديد، وبعدها تدخل بيه.` },
    );

  const restartPrompt = (title: string, icon: 'moon' | 'sunny' | 'language') =>
    alert(
      title,
      'هيتطبق على كل الشاشات لما تفتح البرنامج تاني.',
      [
        ...(Platform.OS === 'android'
          ? [{ text: 'اقفل البرنامج دلوقتي', icon: 'power' as const, onPress: () => BackHandler.exitApp() }]
          : []),
        { text: 'بعدين', style: 'cancel' as const },
      ],
      { icon, tone: 'success' },
    );

  const chooseLanguage = (l: Lang) => {
    setLanguage(l);
    writePrefs({ lang: l });
    if (Platform.OS !== 'web') {
      I18nManager.allowRTL(l === 'ar');
      I18nManager.forceRTL(l === 'ar');
    }
    if (l !== currentLang) restartPrompt(l === 'en' ? 'Language changed ✓' : 'اللغة اتغيّرت ✓', 'language');
  };

  const chooseTheme = (t: ThemeMode) => {
    setTheme(t);
    writePrefs({ theme: t });
    if (t === themeMode) return;
    alert(
      'الوضع اتغيّر ✓',
      'هيتطبق على كل الشاشات لما تفتح البرنامج تاني.',
      [
        ...(Platform.OS === 'android'
          ? [{ text: 'اقفل البرنامج دلوقتي', icon: 'power' as const, onPress: () => BackHandler.exitApp() }]
          : []),
        { text: 'بعدين', style: 'cancel' as const },
      ],
      { icon: t === 'dark' ? 'moon' : 'sunny', tone: 'success' },
    );
  };

  const logout = async () => {
    const ok = await confirm(
      'تسجيل الخروج',
      isAccount
        ? `مسجّل بـ ${user.email ?? ''}. تقدر ترجع تدخل بنفس الإيميل في أي وقت.`
        : 'تقدر ترجع تدخل في أي وقت من أي موبايل بكود الجمعية ورقم موبايلك، وهتلاقي اسمك ودورك ومدفوعاتك زي ما هي.',
      'خروج',
      true,
    );
    if (!ok) return;
    await run(async () => {
      await unregisterPush(user.uid);
      await clearReminders();
      // Free my member rows so code + number brings me back to them on any phone.
      if (!isAccount) await releaseMyMemberships(user.uid, (refs ?? []).filter((r) => r.role === 'member'));
      await signOut();
    });
    if (router.canDismiss()) router.dismissAll();
  };

  return (
    <KeyboardScreen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }}
      >
        {/* Who I am */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text weight="bold" color={colors.white} style={{ fontSize: 30, lineHeight: 44 }}>
              {shownName.slice(0, 1)}
            </Text>
          </View>
          <Text variant="heading" weight="bold" color={colors.white} center>
            {shownName}
          </Text>
          <Badge label={isAccount ? 'صاحب جمعية' : 'عضو'} tone="gold" />
          {isAccount && user.email ? (
            <Text variant="caption" color="rgba(255,255,255,0.85)" selectable>
              {user.email}
            </Text>
          ) : null}
        </View>

        <Row gap={space.sm}>
          <Stat icon="briefcase-outline" label="جمعيات بديرها" value={formatNumber(admin)} />
          <Stat icon="people-outline" label="جمعيات أنا فيها" value={formatNumber(member)} />
        </Row>

        {/* Personal details */}
        <Card>
          <Row gap={space.sm}>
            <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
            <Text variant="heading">بياناتي</Text>
          </Row>
          <Field label="الاسم" value={name} onChangeText={setName} maxLength={60} placeholder="اسمك" />
          {nameChanged ? <Button label="احفظ الاسم" icon="save-outline" loading={busy} onPress={saveName} /> : null}
          <Field
            label={isAccount ? 'حساب إنستاباي اللي الأعضاء بيحوّلوا عليه' : 'حساب إنستاباي بتاعي (للقبض)'}
            value={instapay}
            onChangeText={setInstapay}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="01xxxxxxxxx أو name@instapay"
            error={instapayBad ? 'رقم موبايل متوصل بإنستاباي أو عنوان إنستاباي زي name@instapay' : undefined}
            style={{ textAlign: 'left', writingDirection: 'ltr' }}
          />
          {isAccount ? (
            <Text variant="caption">بيتغيّر في كل الجمعيات اللي بتديرها، والإيصالات بتتراجع عليه.</Text>
          ) : null}
          {instapay.trim() !== savedInstapay.trim() ? (
            <Button label="احفظ حساب إنستاباي" icon="flash-outline" loading={busy} disabled={instapayBad} onPress={saveInstapay} />
          ) : null}

          {isAccount ? (
            <View style={styles.info}>
              <Row gap={space.sm}>
                <Ionicons name="mail-outline" size={18} color={colors.muted} />
                <Text variant="caption" style={{ flex: 1 }}>
                  الإيميل
                </Text>
                {!emailOpen ? (
                  <Text variant="caption" weight="bold" color={colors.primary} onPress={() => setEmailOpen(true)}>
                    تعديل
                  </Text>
                ) : null}
              </Row>
              <Text
                weight="semibold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                selectable
                style={{ writingDirection: 'ltr', textAlign: 'left', marginTop: 2 }}
              >
                {user.email ?? '—'}
              </Text>
              {emailOpen ? (
                <View style={{ gap: space.sm, marginTop: space.sm }}>
                  <Field
                    label="الإيميل الجديد"
                    value={newEmail}
                    onChangeText={setNewEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    error={emailBad ? 'إيميل مش صحيح' : undefined}
                    style={{ textAlign: 'left', writingDirection: 'ltr' }}
                  />
                  <Field label="الباسورد الحالي" value={password} onChangeText={setPassword} secureTextEntry />
                  <Row gap={space.sm}>
                    <Button label="غيّر الإيميل" icon="mail" loading={busy} style={{ flex: 2 }} onPress={saveEmail} />
                    <Button label="إلغاء" variant="ghost" style={{ flex: 1 }} onPress={() => setEmailOpen(false)} />
                  </Row>
                </View>
              ) : null}
            </View>
          ) : (
            <Text variant="caption">إنت داخل كعضو. اسمك وحساب إنستاباي بيظهروا لصاحب الجمعية لما تبعت طلب الانضمام.</Text>
          )}
        </Card>

        {/* Appearance */}
        <Card>
          <Row gap={space.sm}>
            <Ionicons name="color-palette-outline" size={22} color={colors.primary} />
            <Text variant="heading">شكل البرنامج</Text>
          </Row>
          <Segmented
            value={theme}
            onChange={chooseTheme}
            options={[
              { value: 'light', label: '☀️ فاتح' },
              { value: 'dark', label: '🌙 ليلي' },
              { value: 'system', label: 'زي الموبايل' },
            ]}
          />
          <Row gap={space.sm} style={styles.info}>
            <Ionicons name="language-outline" size={18} color={colors.muted} />
            <Text variant="caption" style={{ flex: 1 }}>
              اللغة
            </Text>
          </Row>
          <Segmented
            value={language}
            onChange={chooseLanguage}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Card>

        {/* Notifications */}
        <Card>
          <Row gap={space.sm}>
            <Ionicons name="notifications-outline" size={22} color={colors.primary} />
            <Text variant="heading" style={{ flex: 1 }}>
              الإشعارات
            </Text>
            {notif !== 'unknown' ? (
              <Badge label={notif === 'on' ? 'شغالة ✓' : 'مقفولة'} tone={notif === 'on' ? 'success' : 'danger'} />
            ) : null}
          </Row>
          <Text variant="caption">
            {notif === 'off'
              ? 'الإشعارات مقفولة، فمش هيوصلك تذكير القسط ولا رسايل صاحب الجمعية. افتحها من إعدادات الموبايل.'
              : 'بيوصلك تذكير القسط ورسايل الجمعية على شاشة الموبايل حتى والبرنامج مقفول.'}
          </Text>
          {notif === 'off' ? (
            <Button label="افتح إعدادات الإشعارات" icon="settings-outline" variant="secondary" onPress={() => Linking.openSettings().catch(() => {})} />
          ) : null}
        </Card>

        <Button label="تسجيل الخروج" icon="log-out-outline" variant="danger" onPress={logout} />
        <Text variant="caption" center>
          دوري • نسخة {Constants.expoConfig?.version ?? ''}
        </Text>
      </ScrollView>
    </KeyboardScreen>
  );
}

function Stat({ icon, label, value }: { icon: 'briefcase-outline' | 'people-outline'; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text weight="bold" style={{ fontSize: 22, lineHeight: 32 }}>
        {value}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  info: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
