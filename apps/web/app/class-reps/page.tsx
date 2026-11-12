import type { Metadata } from 'next';
import { ClassRepsWorkspace } from '../../components/class-reps';

export const metadata: Metadata = {
  title: 'Class reps',
  robots: { index: false, follow: false },
};

export default function ClassRepsPage() {
  return <ClassRepsWorkspace />;
}
