import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountGate } from '../../../components/account-gate';
import { ReportList } from '../../../components/course-reports/report-list';

export const metadata: Metadata = {
  title: 'Attendance reports',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Links from before course reports had their own address carried ?courseOfferingId=. */
export default async function LecturerReportsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { courseOfferingId } = await searchParams;
  if (typeof courseOfferingId === 'string' && UUID.test(courseOfferingId)) redirect(`/lecturer/reports/${courseOfferingId.toLowerCase()}`);
  return (
    <AccountGate accountType="lecturer">
      <ReportList />
    </AccountGate>
  );
}
