import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountGate } from '../../../components/account-gate';
import { AttendanceReport } from '../../../components/attendance-report/report';
import { EnrolledCourses } from '../../../components/enrolled-courses/enrolled-courses';
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
      {/* Attendance in enrolled courses (class lists), only where course offerings are in use. */}
      <EnrolledCoursesGate>
        <EnrolledCourses />
      </EnrolledCoursesGate>
    </AccountGate>
  );
}
