import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FREQUENCY_LABEL, formatDate, formatMoney, formatNumber, normalizePayAccount } from '@/core';
import {
  addPendingJoin,
  cancelJoinRequest,
  ensureSignedIn,
  removePendingJoin,
  requestJoin,
  useDirectory,
  useJoinStatus,
  useMyCircles,
  usePendingJoins,
  type DirectoryEntry,
} from '@/data';
import { Badge, Button, Card, Field, Row, Text } from '@/ui/components';
import { confirm, Sheet, useAction } from '@/ui/feedback';
import { SpinningLogo } from '@/ui/SpinningLogo';
import { colors, radius, space } from '@/ui/theme';

/** The spinner shows at least this long so the screen doesn't flash. */
const MIN_LOADING_MS = 1500;

export default function JoinScreen() {
  const [uid, setUid] = useState<string>();
  const [error, setError] = useState<string>();
  const [minDone, setMinDone] = useState(false);

  // Browsing circles needs a (silent, anonymous) sign-in.
  useEffect(() => {
    ensureSignedIn()
      .then((u) => setUid(u.uid))
      .catch(() => setError('مقدرناش نتصل بالسيرفر. اتأكد من النت وجرّب تاني.'));
    const t = setTimeout(() => setMinDone(true), MIN_LOADING_MS);
    return () => clearTimeout(t);
  }, []);

  const directory = useDirectory(!!uid);
  const [sent, setSent] = useState<{ cid: string; circleName: string; name: string } | null>(null);

  if (sent && uid) return <WaitingForApproval {...sent} uid={uid} />;

  const loading = !minDone || !uid || directory.loading;
  if (error || directory.error) {
    return (
      <View style={styles.loadingRoot}>
        <Ionicons name="cloud-offline-outline" size={56} color={colors.gold} />
        <Text color={colors.white} center>
          {error ?? directory.error}
        </Text>
        <Button label="رجوع" icon="arrow-forward" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.loadingRoot}>
        <SpinningLogo label="بندوّر على الجمعيات…" />
      </View>
    );
  }
  return <Directory uid={uid!} items={directory.items ?? []} onSent={setSent} />;
}

function Directory({
  uid,
  items,
  onSent,
}: {
  uid: string;
  items: DirectoryEntry[];
  onSent: (s: { cid: string; circleName: string; name: string }) => void;
}) {
  const insets = useSafeAreaInsets();
  const { refs } = useMyCircles(uid);
  const pending = usePendingJoins();
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState<DirectoryEntry | null>(null);

  const mine = useMemo(() => new Set((refs ?? []).map((r) => r.id)), [refs]);
  const waiting = useMemo(() => new Set(pending.map((p) => p.cid)), [pending]);
  const shown = items.filter((c) => !search.trim() || c.name.includes(search.trim()) || c.adminName.includes(search.trim()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <Text variant="heading">اختار الجمعية اللي عايز تدخلها</Text>
            <Text variant="caption">
              ابعت طلب انضمام باسمك، وصاحب الجمعية هيشوف بياناتك ويوافق عليك من التطبيق.
            </Text>
            {items.length > 4 ? (
              <Field label="بحث" value={search} onChangeText={setSearch} placeholder="اسم الجمعية أو صاحبها" />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Card style={{ alignItems: 'center' }}>
            <Ionicons name="search-outline" size={36} color={colors.muted} />
            <Text center>{items.length ? 'مفيش جمعية بالاسم ده.' : 'مفيش جمعيات مفتوحة دلوقتي. جرّب كمان شوية.'}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <CircleCard
            item={item}
            state={mine.has(item.id) ? 'member' : waiting.has(item.id) ? 'waiting' : 'open'}
            onJoin={() => setJoining(item)}
            onOpen={() => {
              router.dismissAll();
              router.push({ pathname: '/circle/[id]', params: { id: item.id } });
            }}
          />
        )}
      />
      <JoinSheet
        circle={joining}
        uid={uid}
        onClose={() => setJoining(null)}
        onSent={(s) => {
          setJoining(null);
          onSent(s);
        }}
      />
    </View>
  );
}

function CircleCard({
  item,
  state,
  onJoin,
  onOpen,
}: {
  item: DirectoryEntry;
  state: 'open' | 'waiting' | 'member';
  onJoin: () => void;
  onOpen: () => void;
}) {
  const members = item.slots
    ? `${formatNumber(item.memberCount)} من ${formatNumber(item.slots)} عضو`
    : `${formatNumber(item.memberCount)} عضو`;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }} gap={space.sm}>
        <View style={{ flex: 1 }}>
          <Text weight="bold" style={{ fontSize: 18 }} numberOfLines={1}>
            {item.name}
          </Text>
          {item.adminName ? <Text variant="caption">صاحب الجمعية: {item.adminName}</Text> : null}
        </View>
        <View style={styles.amount}>
          <Text weight="bold" color={colors.primary}>
            {formatMoney(item.installment)}
          </Text>
          <Text variant="caption">{FREQUENCY_LABEL[item.frequency]?.every ?? ''}</Text>
        </View>
      </Row>
      <Row gap={space.md}>
        <Row gap={4}>
          <Ionicons name="people-outline" size={16} color={colors.muted} />
          <Text variant="caption">{members}</Text>
        </Row>
        {item.startDate ? (
          <Row gap={4}>
            <Ionicons name="calendar-outline" size={16} color={colors.muted} />
            <Text variant="caption">تبدأ {formatDate(item.startDate)}</Text>
          </Row>
        ) : null}
      </Row>
      {state === 'member' ? (
        <Button label="إنت في الجمعية دي — افتحها" icon="open-outline" variant="secondary" onPress={onOpen} />
      ) : state === 'waiting' ? (
        <Badge label="طلبك مستني موافقة صاحب الجمعية" tone="gold" />
      ) : (
        <Button label="انضمام للجمعية" icon="person-add-outline" onPress={onJoin} />
      )}
    </Card>
  );
}

/** The member enters their own details; the admin sees them on the request. */
function JoinSheet({
  circle,
  uid,
  onClose,
  onSent,
}: {
  circle: DirectoryEntry | null;
  uid: string;
  onClose: () => void;
  onSent: (s: { cid: string; circleName: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const { busy, run } = useAction();
  const accountBad = !!account.trim() && !normalizePayAccount(account);

  const submit = () =>
    circle &&
    run(async () => {
      const result = await requestJoin(circle.id, { name, payAccount: account }, uid);
      if (result.joined) {
        router.dismissAll();
        router.push({ pathname: '/circle/[id]', params: { id: circle.id } });
        return;
      }
      await addPendingJoin({ cid: circle.id, circleName: circle.name, name: name.trim() });
      onSent({ cid: circle.id, circleName: circle.name, name: name.trim() });
    });

  return (
    <Sheet visible={!!circle} title={circle ? `انضمام لـ "${circle.name}"` : ''} onClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
          <Field
            label="اسمك"
            value={name}
            onChangeText={setName}
            maxLength={60}
            autoComplete="name"
            placeholder="الاسم اللي صاحب الجمعية هيشوفه"
          />
          <Field
            label="إنستاباي (اختياري)"
            value={account}
            onChangeText={setAccount}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="رقم الموبايل أو name@instapay"
            error={accountBad ? 'اكتب رقم موبايل أو إيميل إنستاباي صحيح' : undefined}
            hint="علشان تقبض عليه لما ييجي دورك"
          />
          <Button
            label="ابعت طلب الانضمام"
            icon="send"
            loading={busy}
            disabled={!name.trim() || accountBad}
            onPress={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

/** Shown right after sending the request; moves on by itself once the admin approves. */
function WaitingForApproval({ cid, uid, circleName, name }: { cid: string; uid: string; circleName: string; name: string }) {
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
            ? 'تقدر تختار جمعية تانية.'
            : `أول ما يوافق على "${name}" هتدخل "${circleName}" على طول. تقدر تقفل الشاشة دي — هتلاقي الطلب في الصفحة الرئيسية.`}
        </Text>
      </View>
      <Card>
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
  loadingRoot: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  amount: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
});
