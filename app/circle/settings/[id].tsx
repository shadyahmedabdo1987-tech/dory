import { router, useLocalSearchParams } from 'expo-router';

import { saveCircle, useCircleData } from '@/data';
import { useAppSession } from '@/data/session';
import { CircleForm } from '@/features/CircleForm';
import { EmptyState } from '@/ui/components';
import { ErrorScreen, LoadingScreen, useAction } from '@/ui/feedback';

export default function CircleSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAppSession();
  const state = useCircleData(id, user?.uid);
  const { busy, run } = useAction();

  if (state.loading) return <LoadingScreen />;
  if (state.error && !state.data) return <ErrorScreen message={state.error} />;
  if (!state.data || state.role !== 'admin') {
    return <EmptyState icon="lock-closed-outline" title="مش متاح" body="الإعدادات لصاحب الجمعية بس." />;
  }
  const { circle } = state.data;

  return (
    <CircleForm
      mode="edit"
      initial={{
        name: circle.name,
        installment: circle.installment,
        frequency: circle.frequency,
        startDate: circle.startDate,
        members: circle.members,
        slots: circle.slots,
      }}
      submitLabel="حفظ التعديلات"
      busy={busy}
      onSubmit={(draft) =>
        run(async () => {
          await saveCircle(circle, draft.members, draft);
          router.back();
        })
      }
    />
  );
}
