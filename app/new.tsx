import { router } from 'expo-router';

import { CircleForm } from '@/features/CircleForm';
import { useCircles } from '@/store/circles';

export default function NewCircleScreen() {
  const createCircle = useCircles((s) => s.createCircle);
  return (
    <CircleForm
      submitLabel="ابدأ الجمعية"
      onSubmit={(draft) => {
        const circle = createCircle(draft);
        router.replace({ pathname: '/circle/[id]', params: { id: circle.id } });
      }}
    />
  );
}
