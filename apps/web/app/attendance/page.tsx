import type { Metadata } from 'next';
import { AccountGate } from '../../components/account-gate';
import { StudentAttendanceWorkspace } from '../../components/attendance-workspaces';

export const metadata: Metadata = {
  title: 'My attendance',
  robots: { index: false, follow: false },
};

export default function StudentAttendancePage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">STUDENT WORKSPACE</p>
          <h1>My attendance</h1>
          <p className="page-lede">Scan your lecturer’s QR code to check in to a live lecture, and review your recorded check-ins.</p>
        </div>
      </section>
      <AccountGate accountType="student">
        <StudentAttendanceWorkspace />
      </AccountGate>
    </div>
  );
}
