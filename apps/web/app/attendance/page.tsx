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
      <StudentPageHeader title="My attendance" lede="Scan your lecturer’s QR code to check in to a live lecture, and review your recorded check-ins." />
      <AccountGate accountType="student">
        <StudentAttendanceWorkspace />
      </AccountGate>
    </div>
  );
}
