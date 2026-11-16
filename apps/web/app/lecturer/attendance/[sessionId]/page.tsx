import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountGate } from '../../../../components/account-gate';
import { CourseSessionScreen } from '../../../../components/course-sessions/session-screen';

export const metadata: Metadata = {
  title: 'Class',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LecturerClassPage({ params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();
  return (
    <AccountGate accountType="lecturer">
      <CourseSessionScreen sessionId={sessionId.toLowerCase()} />
    </AccountGate>
  );
}
