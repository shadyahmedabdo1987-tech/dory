import { router, useLocalSearchParams } from 'expo-router';

import { CircleForm } from '@/features/CircleForm';
import { useCircle, useCircles } from '@/store/circles';
import { EmptyState } from '@/ui/components';

export default function EditCircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const updateCircle = useCircles((s) => s.updateCircle);

  if (!circle) {
    return <EmptyState icon="alert-circle-outline" title="الجمعية مش موجودة" body="ممكن تكون اتمسحت." />;
  }

  return (
    <CircleForm
      initial={{
        name: circle.name,
        installment: circle.installment,
        frequency: circle.frequency,
        startDate: circle.startDate,
        members: circle.members,
      }}
      submitLabel="حفظ التعديلات"
      onSubmit={(draft) => {
        updateCircle(circle.id, draft);
        router.back();
      }}
    />
  );
}
