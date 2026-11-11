import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { LecturerAttendanceWorkspace } from '../../../components/attendance-workspaces';

export const metadata: Metadata = {
  title: 'Attendance sessions',
  robots: { index: false, follow: false },
};

export default function LecturerAttendancePage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LECTURER WORKSPACE</p>
          <h1>Attendance sessions</h1>
          <p className="page-lede">Open a timed session for an assigned course, share its check-in code, and review the enrolled-student roster.</p>
        </div>
      </section>
      <AccountGate accountType="lecturer">
        <LecturerAttendanceWorkspace />
      </AccountGate>
    </div>
  );
}
