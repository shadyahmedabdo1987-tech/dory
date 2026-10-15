import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FREQUENCY_LABEL,
  formatDate,
  formatMoney,
  formatNumber,
  memberAccount,
  overview,
  payoutPot,
  relativeDays,
} from '@/core';
import { signOut, useCircleData, useMyCircles, type CircleRef } from '@/data';
import { useAppSession } from '@/data/session';
import { clearReminders, registerForPush, unregisterPush, useCircleReminders } from '@/notifications';
import { Badge, Button, Card, EmptyState, ProgressBar, Row, Text } from '@/ui/components';
import { confirm, ErrorScreen } from '@/ui/feedback';
import { colors, radius, shadow, space } from '@/ui/theme';

export default function Index() {
  const { user } = useAppSession();
  return user ? <Home uid={user.uid} /> : <Welcome />;
}

// ---------------------------------------------------------------------------

function Welcome() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.welcome, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Image source={require('../assets/splash-icon.png')} style={styles.logoBig} accessibilityLabel="دوري" />
        <Text variant="title" color={colors.white} style={{ fontSize: 40, lineHeight: 60 }}>
          دوري
        </Text>
        <Text color="rgba(255,255,255,0.85)" center>
          جمعيتك في جيبك.. ودورك مضمون
        </Text>
      </View>

      <View style={{ gap: space.md, alignSelf: 'stretch' }}>
        <Feature icon="calendar-outline" text="جدول أدوار شهري أو كل ٣ شهور، مع تأجيل وأقساط إضافية" />
        <Feature icon="shield-checkmark-outline" text="كل عضو يشوف دوره وحسابه، وصاحب الجمعية يأكد الدفع" />
        <Feature icon="logo-whatsapp" text="دعوات وتذكير بالأقساط على واتساب" />
      </View>

      <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
        <Button label="أنا صاحب جمعية" icon="person-circle-outline" variant="secondary" onPress={() => router.push('/auth')} />
        <Button label="عندي كود دعوة" icon="key-outline" onPress={() => router.push('/join')} style={styles.goldButton} />
      </View>
    </View>
  );
}

function Feature({ icon, text }: { icon: ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <Row gap={space.md}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={20} color={colors.gold} />
      </View>
      <Text color={colors.white} style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

// ---------------------------------------------------------------------------

function Home({ uid }: { uid: string }) {
  const insets = useSafeAreaInsets();
  const { user, isAccount } = useAppSession();
  const { refs, error, loading } = useMyCircles(uid);

  const menu = async () => {
    const ok = await confirm(
      'تسجيل الخروج',
      isAccount
        ? `مسجّل بـ ${user?.email ?? ''}. تقدر ترجع تدخل بنفس الإيميل في أي وقت.`
        : 'إنت داخل كعضو من غير حساب. لو خرجت هتحتاج كود الدعوة ورقمك تاني.',
      'خروج',
      true,
    );
    if (ok) {
      await unregisterPush(uid);
      await clearReminders();
      await signOut();
    }
  };

  // Register for push once the user has at least one circle (permission prompt in context).
  const hasCircles = (refs?.length ?? 0) > 0;
  useEffect(() => {
    if (hasCircles) registerForPush(uid);
  }, [hasCircles, uid]);

  if (error) return <ErrorScreen message={error} />;

  const admin = refs?.filter((r) => r.role === 'admin') ?? [];
  const member = refs?.filter((r) => r.role === 'member') ?? [];
  const sections: (CircleRef | { header: string })[] = [
    ...(member.length ? [{ header: 'جمعيات أنا فيها' }, ...member] : []),
    ...(admin.length ? [{ header: 'جمعيات بديرها' }, ...admin] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.hero, { paddingTop: insets.top + space.lg }]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              {user?.displayName ? `أهلًا يا ${user.displayName}` : 'أهلًا بيك في'}
            </Text>
            <Text variant="title" color={colors.white}>
              دوري
            </Text>
          </View>
          <Pressable onPress={menu} accessibilityLabel="الحساب" hitSlop={10} style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.primary} />
          </Pressable>
        </Row>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.primary} />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => ('header' in item ? item.header : `${item.role}-${item.id}`)}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + 160 }}
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title="لسه مفيش جمعيات"
              body={
                isAccount
                  ? 'اعمل أول جمعية: حدد القسط وميعاد الدفع، ضيف الأعضاء، وابعتلهم الدعوة على واتساب.'
                  : 'ادخل بكود الدعوة اللي وصلك من صاحب الجمعية.'
              }
            />
          }
          renderItem={({ item }) =>
            'header' in item ? (
              <Text variant="heading" style={{ marginTop: space.sm }}>
                {item.header}
              </Text>
            ) : item.role === 'admin' ? (
              <AdminCard id={item.id} uid={uid} />
            ) : (
              <MemberCard id={item.id} uid={uid} />
            )
          }
        />
      )}

      <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
        <Button label="انضم بكود" icon="key-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/join')} />
        <Button
          label="جمعية جديدة"
          icon="add-circle"
          style={{ flex: 1.3 }}
          onPress={() => router.push(isAccount ? '/new' : '/auth')}
        />
      </View>
    </View>
  );
}

function CardShell({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/circle/[id]', params: { id } })}
      style={({ pressed }) => pressed && { opacity: 0.9 }}
    >
      <Card>{children}</Card>
    </Pressable>
  );
}

function AdminCard({ id, uid }: { id: string; uid: string }) {
  const { data } = useCircleData(id, uid);
  useCircleReminders(data?.circle, data?.payments, 'admin', undefined);
  if (!data) return <SkeletonCard />;
  const { circle, payments } = data;
  const o = overview(circle, payments);
  return (
    <CardShell id={id}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
          {circle.name}
        </Text>
        {o.pendingCount > 0 ? (
          <Badge label={`${formatNumber(o.pendingCount)} مستني تأكيد`} tone="gold" />
        ) : o.overdueCount > 0 ? (
          <Badge label={`${formatNumber(o.overdueCount)} متأخر`} tone="danger" />
        ) : o.status === 'finished' ? (
          <Badge label="خلصت" tone="success" />
        ) : (
          <Badge label="منتظمة" tone="success" />
        )}
      </Row>
      <Text variant="caption">
        {formatNumber(circle.members.length)} عضو • {formatMoney(circle.installment)} {FREQUENCY_LABEL[circle.frequency].every} • القبض{' '}
        {formatMoney(payoutPot(circle))}
      </Text>
      {o.nextPayoutEntry && (
        <Row style={styles.note}>
          <Ionicons name="gift-outline" size={16} color={colors.primary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
            القبض الجاي: <Text weight="bold">{o.nextPayoutEntry.recipient?.name}</Text> — {formatDate(o.nextPayoutEntry.date)}
          </Text>
        </Row>
      )}
      <ProgressBar value={o.ratio} />
    </CardShell>
  );
}

function MemberCard({ id, uid }: { id: string; uid: string }) {
  const { data, myMemberId } = useCircleData(id, uid);
  useCircleReminders(data?.circle, data?.payments, 'member', myMemberId);
  if (!data || !myMemberId || !data.circle.members.some((m) => m.id === myMemberId)) return <SkeletonCard />;
  const acc = memberAccount(data.circle, data.payments, myMemberId);
  const next = acc.nextDue;
  return (
    <CardShell id={id}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
          {data.circle.name}
        </Text>
        {acc.overdueAmount > 0 ? (
          <Badge label="عليك متأخرات" tone="danger" />
        ) : acc.totalPending > 0 ? (
          <Badge label="مستني تأكيد" tone="gold" />
        ) : (
          <Badge label="حسابك تمام" tone="success" />
        )}
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <Text variant="caption">القسط الجاي</Text>
          <Text weight="bold">{next ? formatMoney(next.entry.due) : '—'}</Text>
          {next && <Text variant="caption">{formatDate(next.entry.date)}</Text>}
        </View>
        <View>
          <Text variant="caption">دورك في القبض</Text>
          <Text weight="bold">{acc.nextPayout ? formatDate(acc.nextPayout.entry.date, false) : 'قبضت ✓'}</Text>
          {acc.nextPayout && <Text variant="caption">{relativeDays(acc.nextPayout.inDays)}</Text>}
        </View>
      </Row>
      <ProgressBar value={acc.totalCommitment ? acc.totalPaid / acc.totalCommitment : 0} color={colors.success} />
    </CardShell>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '60%' }]} />
    </Card>
  );
}

const styles = StyleSheet.create({
  welcome: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoBig: { width: 150, height: 150 },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldButton: { backgroundColor: colors.gold, borderColor: colors.gold },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.lg + 6,
    borderBottomRightRadius: radius.lg + 6,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: space.sm },
  actions: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: 0,
    flexDirection: 'row',
    gap: space.sm,
    ...shadow,
  },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: colors.border, width: '85%' },
});
