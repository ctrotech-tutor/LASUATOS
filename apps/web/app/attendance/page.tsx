import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountGate } from '../../components/account-gate';
import { MyAttendance } from '../../components/my-attendance/my-attendance';

export const metadata: Metadata = {
  title: 'My attendance',
  robots: { index: false, follow: false },
};

export default function StudentAttendancePage() {
  return (
    <AccountGate accountType="student">
      <Suspense>
        <MyAttendance />
      </Suspense>
    </AccountGate>
  );
}
