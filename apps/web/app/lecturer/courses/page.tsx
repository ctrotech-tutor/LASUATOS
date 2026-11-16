import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { LecturerCourses } from '../../../components/lecturer-courses/lecturer-courses';

export const metadata: Metadata = {
  title: 'Course tools',
  robots: { index: false, follow: false },
};

export default function LecturerCoursesPage() {
  return (
    <AccountGate accountType="lecturer">
      <LecturerCourses />
    </AccountGate>
  );
}
