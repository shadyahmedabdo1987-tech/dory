import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  formatDate,
  formatMoney,
  formatNumber,
  potSize,
  progress,
  summarizeCycle,
  todayISO,
  type Circle,
} from '@/core';
import { useCircles } from '@/store/circles';
import { Badge, Button, Card, EmptyState, ProgressBar, Row, Text } from '@/ui/components';
import { colors, radius, shadow, space } from '@/ui/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const circles = useCircles((s) => s.circles);
  const today = todayISO();

  const totals = useMemo(() => {
    let overdue = 0;
    let active = 0;
    for (const c of circles) {
      const p = progress(c, today);
      overdue += p.overdueAmount;
      if (p.status === 'active') active++;
    }
    return { overdue, active };
  }, [circles, today]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.hero, { paddingTop: insets.top + space.lg }]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              أهلًا بيك في
            </Text>
            <Text variant="title" color={colors.white}>
              الجمعية
            </Text>
          </View>
          <View style={styles.logo}>
            <Ionicons name="people" size={26} color={colors.primary} />
          </View>
        </Row>
        <Row gap={space.md} style={{ marginTop: space.lg }}>
          <Stat label="جمعيات شغالة" value={formatNumber(totals.active)} />
          <Stat label="متأخرات" value={formatMoney(totals.overdue)} warn={totals.overdue > 0} />
        </Row>
      </View>

      <FlatList
        data={circles}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + 110 }}
        ListEmptyComponent={
          <EmptyState
            icon="wallet-outline"
            title="لسه مفيش جمعيات"
            body="اعمل أول جمعية في دقيقة: حدد القسط، ضيف الأعضاء، واعمل القرعة على الأدوار."
          />
        }
        renderItem={({ item }) => <CircleCard circle={item} today={today} />}
      />

      <View style={[styles.fabWrap, { paddingBottom: insets.bottom + space.lg }]}>
        <Button label="جمعية جديدة" icon="add-circle" onPress={() => router.push('/new')} />
      </View>
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" color="rgba(255,255,255,0.75)">
        {label}
      </Text>
      <Text variant="heading" weight="bold" color={warn ? '#FFD6A5' : colors.white}>
        {value}
      </Text>
    </View>
  );
}

function CircleCard({ circle, today }: { circle: Circle; today: string }) {
  const p = progress(circle, today);
  const cycle = Math.max(0, Math.min(p.currentCycle, circle.members.length - 1));
  const summary = summarizeCycle(circle, p.status === 'upcoming' ? 0 : cycle);

  const status =
    p.status === 'finished'
      ? { label: 'خلصت', tone: 'success' as const }
      : p.status === 'upcoming'
        ? { label: `تبدأ ${formatDate(circle.startDate, false)}`, tone: 'gold' as const }
        : p.overdueCount > 0
          ? { label: `${formatNumber(p.overdueCount)} متأخر`, tone: 'danger' as const }
          : { label: 'منتظمة', tone: 'success' as const };

  return (
    <Link href={{ pathname: '/circle/[id]', params: { id: circle.id } }} asChild>
      <Pressable accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.9 }}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
              {circle.name}
            </Text>
            <Badge label={status.label} tone={status.tone} />
          </Row>

          <Row style={{ justifyContent: 'space-between' }}>
            <Info label="القسط" value={formatMoney(circle.installment, circle.currency)} />
            <Info label="القبض" value={formatMoney(potSize(circle), circle.currency)} />
            <Info label="الأعضاء" value={formatNumber(circle.members.length)} />
          </Row>

          {p.status !== 'finished' && (
            <Row style={styles.turn}>
              <Ionicons name="gift-outline" size={18} color={colors.primary} />
              <Text variant="caption" color={colors.text} style={{ flex: 1 }}>
                الدور على <Text weight="bold">{summary.recipient.name}</Text> — {formatDate(summary.date)}
              </Text>
            </Row>
          )}

          <View style={{ gap: space.xs }}>
            <ProgressBar value={p.ratio} />
            <Text variant="caption">
              قبض {formatNumber(p.paidOut)} من {formatNumber(p.totalCycles)}
            </Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text variant="caption">{label}</Text>
      <Text weight="bold">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.lg + 6,
    borderBottomRightRadius: radius.lg + 6,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    padding: space.md,
  },
  turn: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  fabWrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: 0,
    ...shadow,
  },
});
