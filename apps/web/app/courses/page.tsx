import type { Metadata } from 'next';
import { AccountGate } from '../../components/account-gate';
import { StudentPageHeader } from '../../components/student-page-header';
import { StudentCoursesWorkspace } from '../../components/course-workspaces';
import { StudentLevelCard } from '../../components/student-level-card';

export const metadata: Metadata = {
  title: 'My courses',
  robots: { index: false, follow: false },
};

export default function StudentCoursesPage() {
  return (
    <div className="page-stack courses-page">
      <StudentPageHeader title="My courses" lede="Join a course with a code from your lecturer and keep track of your current course enrollments." />
      <AccountGate accountType="student">
        <StudentLevelCard />
        <StudentCoursesWorkspace />
      </AccountGate>
    </div>
  );
}
