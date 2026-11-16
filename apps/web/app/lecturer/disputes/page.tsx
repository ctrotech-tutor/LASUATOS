import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { CourseDisputes } from '../../../components/course-disputes/dispute-list';

export const metadata: Metadata = {
  title: 'Attendance disputes',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?courseOfferingId= shows one course's disputes (Course tools and each report link here with it). */
export default async function LecturerDisputesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { courseOfferingId } = await searchParams;
  const course = typeof courseOfferingId === 'string' && UUID.test(courseOfferingId) ? courseOfferingId.toLowerCase() : '';
  return (
    <AccountGate accountType="lecturer">
      <CourseDisputes key={course} courseOfferingId={course} />
    </AccountGate>
  );
}
