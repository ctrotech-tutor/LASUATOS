import type { Metadata } from 'next';
import { AccountGate } from '../../components/account-gate';
import { StudentPageHeader } from '../../components/student-page-header';
import { StudentAttendanceWorkspace } from '../../components/student-attendance';

export const metadata: Metadata = {
  title: 'My attendance',
  robots: { index: false, follow: false },
};

export default function StudentAttendancePage() {
  return (
    <div className="page-stack attendance-page">
      <StudentPageHeader title="My attendance" lede="Scan the QR code in class to mark attendance, and see every lecture you’ve marked." />
      <AccountGate accountType="student">
        <StudentAttendanceWorkspace />
      </AccountGate>
    </div>
  );
}
