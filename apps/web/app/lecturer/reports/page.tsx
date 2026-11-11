import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { AttendanceReportWorkspace } from '../../../components/attendance-report-workspace';

export const metadata: Metadata = {
  title: 'Attendance reports',
  robots: { index: false, follow: false },
};

export default function LecturerReportsPage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LECTURER WORKSPACE</p>
          <h1>Attendance reports</h1>
          <p className="page-lede">Review attendance across every session of a course, follow up with students below your threshold, correct records with an audited reason, and export the register.</p>
        </div>
      </section>
      <AccountGate accountType="lecturer">
        <AttendanceReportWorkspace />
      </AccountGate>
    </div>
  );
}
