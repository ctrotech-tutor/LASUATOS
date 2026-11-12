import type { Metadata } from 'next';
import { LectureSessionsHome } from '../../components/lecture-sessions';

export const metadata: Metadata = {
  title: 'Take attendance',
  robots: { index: false, follow: false },
};

export default function SessionsPage() {
  return <LectureSessionsHome />;
}
