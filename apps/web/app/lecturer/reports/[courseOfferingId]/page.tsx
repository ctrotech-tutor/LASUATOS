import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountGate } from '../../../../components/account-gate';
import { CourseReport } from '../../../../components/course-reports/course-report';

export const metadata: Metadata = {
  title: 'Attendance report',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LecturerCourseReportPage({ params }: Readonly<{ params: Promise<{ courseOfferingId: string }> }>) {
  const { courseOfferingId } = await params;
  if (!UUID.test(courseOfferingId)) notFound();
  return (
    <AccountGate accountType="lecturer">
      <CourseReport courseOfferingId={courseOfferingId.toLowerCase()} />
    </AccountGate>
  );
}
