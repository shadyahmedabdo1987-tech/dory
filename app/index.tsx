import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
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
import {
  reloadCircle,
  removePendingJoin,
  useCircleData,
  useJoinStatus,
  useMyCircles,
  usePendingJoins,
  type CircleRef,
  type PendingJoin,
} from '@/data';
import { useAppSession } from '@/data/session';
import { registerForPush, useCirclePush, useCircleReminders } from '@/notifications';
import { Badge, Button, Card, EmptyState, ProgressBar, Row, Text } from '@/ui/components';
import { ErrorScreen } from '@/ui/feedback';
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
      {/* Logo, name and tagline centred in the free space. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <Image source={require('../assets/splash-icon.png')} style={styles.logoBig} accessibilityLabel="دوري" />
        <Text variant="title" color={colors.white} style={{ fontSize: 56, lineHeight: 84 }}>
          دوري
        </Text>
        <Text color="rgba(255,255,255,0.9)" center style={{ fontSize: 20, lineHeight: 32 }}>
          جمعيتك في جيبك.. ودورك مضمون
        </Text>
      </View>

      <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
        <Button label="أنا صاحب جمعية" icon="person-circle-outline" variant="secondary" onPress={() => router.push('/auth')} />
        <Button label="عندي كود دعوة" icon="key-outline" onPress={() => router.push('/join')} style={styles.goldButton} />
      </View>
    </View>
  );
}


// ---------------------------------------------------------------------------

function Home({ uid }: { uid: string }) {
  const insets = useSafeAreaInsets();
  const { user, isAccount } = useAppSession();
  const { refs, error, loading } = useMyCircles(uid);
  const pending = usePendingJoins();

  // Register for push once the user has at least one circle (permission prompt in context).
  const hasCircles = (refs?.length ?? 0) > 0;
  useEffect(() => {
    if (hasCircles) registerForPush(uid);
  }, [hasCircles, uid]);

  if (error) return <ErrorScreen message={error} />;

  const admin = refs?.filter((r) => r.role === 'admin') ?? [];
  const member = refs?.filter((r) => r.role === 'member') ?? [];
  const memberIds = new Set(member.map((r) => r.id));
  const waiting = pending.filter((p) => !memberIds.has(p.cid));
  const sections: (CircleRef | { header: string } | { pending: PendingJoin })[] = [
    ...(waiting.length ? [{ header: 'طلبات مستنية موافقة' }, ...waiting.map((p) => ({ pending: p }))] : []),
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
          <Pressable
            onPress={() => router.push('/account')}
            accessibilityLabel="حسابي"
            hitSlop={10}
            style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.85 }]}
          >
            {user?.displayName?.trim() ? (
              <Text weight="bold" color={colors.white} style={{ fontSize: 20, lineHeight: 30 }}>
                {user.displayName.trim().slice(0, 1)}
              </Text>
            ) : (
              <Ionicons name="person" size={22} color={colors.white} />
            )}
          </Pressable>
        </Row>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} color={colors.primary} />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) =>
            'header' in item ? item.header : 'pending' in item ? `pending-${item.pending.cid}` : `${item.role}-${item.id}`
          }
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + 160 }}
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title="لسه مفيش جمعيات"
              body={
                isAccount
                  ? 'اعمل أول جمعية: حدد القسط وميعاد الدفع، وحدد عدد الأعضاء، والناس هتبعتلك طلبات انضمام توافق عليها.'
                  : 'دوس "عندي كود دعوة" واكتب الكود اللي وصلك من صاحب الجمعية.'
              }
            />
          }
          renderItem={({ item }) =>
            'header' in item ? (
              <Text variant="heading" style={{ marginTop: space.sm }}>
                {item.header}
              </Text>
            ) : 'pending' in item ? (
              <PendingJoinCard item={item.pending} uid={uid} />
            ) : item.role === 'admin' ? (
              <AdminCard id={item.id} uid={uid} />
            ) : (
              <MemberCard id={item.id} uid={uid} />
            )
          }
        />
      )}

      <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
        <Button label="عندي كود دعوة" icon="key-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/join')} />
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
  const { data, error } = useCircleData(id, uid);
  useCircleReminders(data?.circle, data?.payments, 'admin', undefined);
  useCirclePush(data ? id : undefined, uid);
  if (!data) return error ? <RetryCard message={error} onRetry={() => reloadCircle(id, uid)} /> : <SkeletonCard />;
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
  const { data, myMemberId, error } = useCircleData(id, uid);
  useCircleReminders(data?.circle, data?.payments, 'member', myMemberId);
  useCirclePush(data ? id : undefined, uid);
  if (!data && error) return <RetryCard message={error} onRetry={() => reloadCircle(id, uid)} />;
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

function PendingJoinCard({ item, uid }: { item: PendingJoin; uid: string }) {
  const status = useJoinStatus(item.cid, uid);
  useEffect(() => {
    // Approved: the circle now shows up under "my circles".
    if (status === 'approved') removePendingJoin(item.cid);
  }, [status, item.cid]);
  if (status === 'approved') return null;
  const rejected = status === 'gone';
  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name={rejected ? 'close-circle' : 'hourglass-outline'} size={24} color={rejected ? colors.danger : colors.gold} />
        <View style={{ flex: 1 }}>
          <Text weight="semibold">{rejected ? `صاحب "${item.circleName}" ما وافقش على طلبك` : `طلب انضمام لـ "${item.circleName}"`}</Text>
          <Text variant="caption">
            {rejected ? 'اتأكد من الكود مع صاحب الجمعية وابعت طلب جديد.' : `باسم ${item.name} • مستني موافقة صاحب الجمعية`}
          </Text>
        </View>
      </Row>
      {rejected ? <Button label="تمام" icon="checkmark" variant="secondary" onPress={() => removePendingJoin(item.cid)} /> : null}
    </Card>
  );
}

function RetryCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <Row gap={space.sm}>
        <Ionicons name="cloud-offline-outline" size={22} color={colors.muted} />
        <Text variant="caption" style={{ flex: 1 }}>
          {message}
        </Text>
      </Row>
      <Button label="جرّب تاني" icon="refresh" variant="secondary" onPress={onRetry} />
    </Card>
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
  logoBig: { width: 210, height: 210 },
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
