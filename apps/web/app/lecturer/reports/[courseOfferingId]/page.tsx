import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountGate } from '../../../../components/account-gate';
import { CourseReport } from '../../../../components/course-reports/course-report';

export const metadata: Metadata = {
  title: 'Attendance report',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: string | string[] | undefined) => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);

/** ?student= opens that student, and with &class= their mark in that class (disputes link here). */
export default async function LecturerCourseReportPage({ params, searchParams }: Readonly<{
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const [{ courseOfferingId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(courseOfferingId)) notFound();
  const studentId = id(query.student);
  return (
    <AccountGate accountType="lecturer">
      <CourseReport
        courseOfferingId={courseOfferingId.toLowerCase()}
        focus={studentId ? { studentId, sessionId: id(query.class) } : null}
      />
    </AccountGate>
  );
}
