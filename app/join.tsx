import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { extractInviteCode } from '@/core';
import { addPendingJoin, cancelJoinRequest, ensureSignedIn, removePendingJoin, requestJoin, useJoinStatus } from '@/data';
import { Button, Card, Field, Text } from '@/ui/components';
import { alert } from '@/ui/dialog';
import { confirm, useAction } from '@/ui/feedback';
import { colors, radius, space } from '@/ui/theme';

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(extractInviteCode(params.code ?? '') ?? (params.code ?? '').toUpperCase());

  // Typing keeps letters/digits only; pasting a whole invite message pulls the code out of it.
  const onCodeChange = (t: string) =>
    setCode(extractInviteCode(t) ?? t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));

  const pasteCode = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const found = extractInviteCode(text ?? '');
    if (found) setCode(found);
    else alert('مفيش كود في اللي نسخته', 'انسخ رسالة الدعوة أو كود الجمعية، وبعدين دوس "الصق الكود".');
  };
  const [name, setName] = useState('');
  const [sent, setSent] = useState<{ cid: string; uid: string } | null>(null);
  const { busy, run } = useAction();

  const submit = () =>
    run(async () => {
      const me = await ensureSignedIn();
      const result = await requestJoin(code, name, me.uid);
      if (result.joined) {
        router.dismissAll();
        router.push({ pathname: '/circle/[id]', params: { id: result.cid } });
        return;
      }
      await addPendingJoin({ cid: result.cid, code, name: name.trim() });
      setSent({ cid: result.cid, uid: me.uid });
    });

  if (sent) return <WaitingForApproval cid={sent.cid} uid={sent.uid} code={code} name={name.trim()} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Ionicons name="people-circle" size={56} color={colors.gold} />
          <Text variant="heading" color={colors.white} center>
            تابع جمعيتك زي تطبيق البنك
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.8)" center>
            دورك، الأقساط اللي عليك، واللي دفعته — كله قدامك.
          </Text>
        </View>
        <Card>
          <Field
            label="كود الجمعية"
            value={code}
            onChangeText={onCodeChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="مثلًا: K7QX2M"
            hint="هتلاقيه في رسالة الدعوة من صاحب الجمعية"
            style={{ letterSpacing: 4, textAlign: 'center', fontSize: 20 }}
          />
          <Button label="الصق الكود" icon="clipboard-outline" variant="secondary" onPress={pasteCode} />
          <Field
            label="اسمك"
            value={name}
            onChangeText={setName}
            maxLength={60}
            autoComplete="name"
            placeholder="اسمك زي ما صاحب الجمعية عارفك"
            hint="صاحب الجمعية هيشوف اسمك ويأكد دخولك من التطبيق"
          />
          <Button
            label="ابعت طلب الانضمام"
            icon="send"
            loading={busy}
            disabled={code.trim().length < 6 || !name.trim()}
            onPress={submit}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Shown right after sending the request; moves on by itself once the admin approves. */
function WaitingForApproval({ cid, uid, code, name }: { cid: string; uid: string; code: string; name: string }) {
  const status = useJoinStatus(cid, uid);
  const { run } = useAction();

  useEffect(() => {
    if (status !== 'approved') return;
    removePendingJoin(cid);
    router.dismissAll();
    router.push({ pathname: '/circle/[id]', params: { id: cid } });
  }, [status, cid]);

  const rejected = status === 'gone';
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={[styles.hero, rejected && { backgroundColor: colors.danger }]}>
        <Ionicons name={rejected ? 'close-circle' : 'hourglass'} size={56} color={rejected ? colors.white : colors.gold} />
        <Text variant="heading" color={colors.white} center>
          {rejected ? 'صاحب الجمعية ما وافقش على الطلب' : 'طلبك وصل لصاحب الجمعية'}
        </Text>
        <Text variant="caption" color="rgba(255,255,255,0.85)" center>
          {rejected
            ? 'اتأكد من الكود واسمك مع صاحب الجمعية، وابعت طلب جديد.'
            : `أول ما يوافق على "${name}" هتدخل الجمعية على طول. تقدر تقفل الشاشة دي — هتلاقي الطلب في الصفحة الرئيسية.`}
        </Text>
      </View>
      <Card>
        <Text variant="caption">كود الجمعية: {code}</Text>
        {rejected ? (
          <Button
            label="رجوع"
            icon="arrow-forward"
            onPress={() => {
              removePendingJoin(cid);
              router.back();
            }}
          />
        ) : (
          <>
            <Button label="تمام" icon="checkmark" onPress={() => router.back()} />
            <Button
              label="إلغاء الطلب"
              icon="close"
              variant="ghost"
              onPress={async () => {
                if (!(await confirm('إلغاء الطلب؟', 'صاحب الجمعية مش هيشوف طلبك.', 'إلغاء الطلب', true))) return;
                run(async () => {
                  await cancelJoinRequest(cid, uid);
                  await removePendingJoin(cid);
                  router.back();
                });
              }}
            />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
});
