import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { AttendanceAppeals } from '../../../components/attendance-appeals/appeals';

export const metadata: Metadata = {
  title: 'Attendance appeals',
  robots: { index: false, follow: false },
};

export default function AttendanceAppealsPage() {
  return (
    <AccountGate accountType="administrator">
      <AttendanceAppeals />
    </AccountGate>
  );
}
