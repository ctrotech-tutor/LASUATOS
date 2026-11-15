import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountGate } from '../../../components/account-gate';
import { AdministratorAttendanceWorkspace } from '../../../components/administrator-attendance-workspace';
import { AttendanceReport } from '../../../components/attendance-report/report';
import { EnrolledCoursesGate } from '../../../components/enrolled-courses-gate';

export const metadata: Metadata = {
  title: 'Attendance overview · LASUATOS administration',
  robots: { index: false, follow: false },
};

export default function AdminAttendancePage() {
  return (
    <AccountGate accountType="administrator">
      {/* The period and department are read from the URL on the client. */}
      <Suspense fallback={null}>
        <AttendanceReport />
      </Suspense>
      {/* The older enrolled-course reports, only where course offerings are in use. */}
      <EnrolledCoursesGate>
        <section className="ds-section ar-enrolled" aria-labelledby="ar-enrolled-title">
          <div className="ds-section-head">
            <h2 className="ds-section-title" id="ar-enrolled-title">Enrolled courses</h2>
          </div>
          <AdministratorAttendanceWorkspace />
        </section>
      </EnrolledCoursesGate>
    </AccountGate>
  );
}
