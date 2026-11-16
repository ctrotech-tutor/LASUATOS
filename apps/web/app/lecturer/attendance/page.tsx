import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { CourseSessions } from '../../../components/course-sessions/course-sessions';

export const metadata: Metadata = {
  title: 'Course sessions',
  robots: { index: false, follow: false },
};

export default function LecturerAttendancePage() {
  return (
    <AccountGate accountType="lecturer">
      <CourseSessions />
    </AccountGate>
  );
}
