import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { AdministratorAttendanceWorkspace } from '../../../components/administrator-attendance-workspace';
import { EnrolledCoursesGate } from '../../../components/enrolled-courses-gate';
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
          <p className="page-lede">Every QR attendance session in your scope: how many took place, who attended, and which courses and departments are most active.</p>
        </div>
      </section>
      <AccountGate accountType="administrator">
        <LectureSummaryPanel />
        <EnrolledCoursesGate note="Reports for enrolled course offerings appear here once a lecturer creates a course offering with an enrollment code. QR attendance, above, needs no enrollment.">
          <section className="page-stack" aria-labelledby="enrolled-heading">
            <div className="section-intro">
              <p className="section-kicker">ENROLLED COURSES</p>
              <h2 id="enrolled-heading">Course offerings with enrolled students</h2>
            </div>
            <AdministratorAttendanceWorkspace />
          </section>
        </EnrolledCoursesGate>
      </AccountGate>
    </div>
  );
}
