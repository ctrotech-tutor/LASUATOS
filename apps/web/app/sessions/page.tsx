import type { Metadata } from 'next';
import { TakeAttendanceHome } from '../../components/take-attendance';

export const metadata: Metadata = {
  title: 'Take attendance',
  robots: { index: false, follow: false },
};

export default function SessionsPage() {
  return <TakeAttendanceHome />;
}
