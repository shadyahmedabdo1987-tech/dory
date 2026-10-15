import { Redirect, router } from 'expo-router';

import { createCircle } from '@/data';
import { useAppSession } from '@/data/session';
import { CircleForm } from '@/features/CircleForm';
import { useAction } from '@/ui/feedback';

export default function NewCircleScreen() {
  const { user, isAccount } = useAppSession();
  const { busy, run } = useAction();

  if (!user || !isAccount) return <Redirect href="/auth" />;

  return (
    <CircleForm
      mode="create"
      ownerName={user.displayName ?? ''}
      submitLabel="ابدأ الجمعية"
      busy={busy}
      onSubmit={(draft) =>
        run(async () => {
          const id = await createCircle(draft, user.uid);
          router.replace({ pathname: '/circle/[id]', params: { id, tab: 'members' } });
        })
      }
    />
  );
}
