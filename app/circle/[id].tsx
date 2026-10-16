import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable } from 'react-native';

import { deleteCircle, leaveCircle, reloadCircle, useCircleData } from '@/data';
import { useAppSession } from '@/data/session';
import { AdminView, type AdminTab } from '@/features/AdminView';
import { MemberView } from '@/features/MemberView';
import { clearReminders } from '@/notifications';
import { EmptyState, Row } from '@/ui/components';
import { confirm, ErrorScreen, LoadingScreen, useAction } from '@/ui/feedback';
import { colors, space } from '@/ui/theme';

export default function CircleScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: AdminTab }>();
  const { user } = useAppSession();
  const state = useCircleData(id, user?.uid);
  const { run } = useAction();

  if (!user) return <EmptyState icon="log-in-outline" title="سجّل دخول الأول" body="" />;
  if (state.loading) return <LoadingScreen />;
  if (state.notFound) {
    return <EmptyState icon="alert-circle-outline" title="الجمعية مش متاحة" body="ممكن تكون اتمسحت، أو صاحب الجمعية فك ربط موبايلك." />;
  }
  if (!state.data)
    return <ErrorScreen message={state.error ?? 'حصلت مشكلة'} onRetry={user ? () => reloadCircle(id, user.uid) : undefined} />;

  const { circle, payments } = state.data;
  const isAdmin = state.role === 'admin';
  const myMember = circle.members.find((m) => m.id === state.myMemberId);

  const onDelete = async () => {
    const ok = await confirm('مسح الجمعية؟', `هيتمسح "${circle.name}" بكل الأقساط والأعضاء نهائيًا، ومحدش هيقدر يشوفها تاني.`, 'امسح نهائيًا', true);
    if (ok) {
      await run(async () => {
        await deleteCircle(circle);
        await clearReminders(circle.id);
        router.back();
      });
    }
  };

  const onLeave = async () => {
    if (!myMember) return;
    const ok = await confirm('الخروج من الجمعية؟', 'هتقدر ترجع تدخل بالكود ورقمك في أي وقت.', 'اخرج', true);
    if (ok) {
      await run(async () => {
        await leaveCircle(circle.id, myMember.id, user.uid);
        await clearReminders(circle.id);
        router.back();
      });
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: circle.name,
          headerRight: () => (
            <Row gap={space.lg}>
              {isAdmin ? (
                <>
                  <Pressable
                    accessibilityLabel="الإعدادات"
                    hitSlop={10}
                    onPress={() => router.push({ pathname: '/circle/settings/[id]', params: { id: circle.id } })}
                  >
                    <Ionicons name="settings-outline" size={22} color={colors.white} />
                  </Pressable>
                  <Pressable accessibilityLabel="مسح الجمعية" hitSlop={10} onPress={onDelete}>
                    <Ionicons name="trash-outline" size={22} color={colors.white} />
                  </Pressable>
                </>
              ) : (
                <Pressable accessibilityLabel="خروج من الجمعية" hitSlop={10} onPress={onLeave}>
                  <Ionicons name="exit-outline" size={22} color={colors.white} />
                </Pressable>
              )}
            </Row>
          ),
        }}
      />
      {isAdmin ? (
        <AdminView circle={circle} payments={payments} uid={user.uid} initialTab={tab} />
      ) : myMember ? (
        <MemberView circle={circle} payments={payments} memberId={myMember.id} uid={user.uid} />
      ) : (
        <EmptyState icon="person-remove-outline" title="مش مربوط بعضو" body="اطلب من صاحب الجمعية يبعتلك دعوة جديدة." />
      )}
    </>
  );
}
