import type { Metadata } from 'next';
import { AccountGate } from '../../components/account-gate';
import { StudentCourses } from '../../components/student-courses/student-courses';

export const metadata: Metadata = {
  title: 'My courses',
  robots: { index: false, follow: false },
};

export default function StudentCoursesPage() {
  return (
    <AccountGate accountType="student">
      <StudentCourses />
    </AccountGate>
  );
}
