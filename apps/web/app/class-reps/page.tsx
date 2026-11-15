import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassReps } from '../../components/class-reps/class-reps';

export const metadata: Metadata = {
  title: 'Class reps',
  robots: { index: false, follow: false },
};

export default function ClassRepsPage() {
  return (
    <Suspense>
      <ClassReps />
    </Suspense>
  );
}
