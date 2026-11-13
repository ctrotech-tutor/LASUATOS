import type { Metadata } from 'next';
import { LectureCheckIn } from '../../components/lecture-check-in';

export const metadata: Metadata = {
  title: 'Mark attendance',
  description: 'Scan the class QR code or type the code to mark your attendance with your student account.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function MarkAttendancePage() {
  return <LectureCheckIn />;
}
