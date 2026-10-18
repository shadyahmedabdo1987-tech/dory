import { router, useLocalSearchParams } from 'expo-router';

import { saveCircle, setInstapayForMyCircles, useCircleData } from '@/data';
import { useAppSession } from '@/data/session';
import { CircleForm } from '@/features/CircleForm';
import { readPrefsSync } from '@/ui/prefs';
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
      ownerMemberId={circle.ownerMemberId}
      ownerPay={{ number: circle.payInfo?.instapay ?? '', address: circle.payInfo?.instapayAddress ?? '' }}
      submitLabel="حفظ التعديلات"
      busy={busy}
      onSubmit={(draft) =>
        run(async () => {
          await saveCircle(circle, draft.members, draft);
          // A circle made before the InstaPay was saved on the account picks it up now.
          const saved = readPrefsSync().adminInstapay;
          if (!circle.payInfo?.instapay && !circle.payInfo?.instapayAddress && saved && (saved.number || saved.address)) {
            await setInstapayForMyCircles(circle.adminUid, saved).catch(() => {});
          }
          router.back();
        })
      }
    />
  );
}
