import type { Metadata } from 'next';
import { CourseCheckIn } from '../../components/check-in/check-in';

export const metadata: Metadata = {
  title: 'Check in',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function CheckInPage() {
  return <CourseCheckIn />;
}
