import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LectureSessionView } from '../../../components/lecture-sessions';

export const metadata: Metadata = {
  title: 'Attendance session',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SessionPage({ params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();
  return <LectureSessionView sessionId={sessionId.toLowerCase()} />;
}
