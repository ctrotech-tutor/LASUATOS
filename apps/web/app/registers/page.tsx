import type { Metadata } from 'next';
import { CourseRegisters } from '../../components/course-registers';

export const metadata: Metadata = {
  title: 'Course registers',
  robots: { index: false, follow: false },
};

export default function RegistersPage() {
  return <CourseRegisters />;
}
