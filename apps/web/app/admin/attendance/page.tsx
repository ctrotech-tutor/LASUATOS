import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { AdministratorAttendanceWorkspace } from '../../../components/administrator-attendance-workspace';
import { LectureSummaryPanel } from '../../../components/lecture-summary';

export const metadata: Metadata = {
  title: 'Attendance overview · LASUATOS administration',
  robots: { index: false, follow: false },
};

export default function AdminAttendancePage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ADMINISTRATION</p>
          <h1>Attendance overview</h1>
          <p className="page-lede">Attendance taken with QR codes across your scope, then attendance rates for course offerings with enrolled students.</p>
        </div>
      </section>
      <AccountGate accountType="administrator">
        <LectureSummaryPanel />
        <section className="page-stack" aria-labelledby="enrolled-heading">
          <div className="section-intro">
            <p className="section-kicker">ENROLLED COURSES</p>
            <h2 id="enrolled-heading">Course offerings with enrolled students</h2>
          </div>
          <AdministratorAttendanceWorkspace />
        </section>
      </AccountGate>
    </div>
  );
}
