import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { AdministratorAttendanceWorkspace } from '../../../components/administrator-attendance-workspace';

export const metadata: Metadata = {
  title: 'Attendance overview · LASUATOS administration',
  robots: { index: false, follow: false },
};

export default function AdminAttendancePage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ADMINISTRATION</p>
          <h1>Attendance overview</h1>
          <p className="page-lede">Attendance health for every course offering in your assigned scope, using the same rules lecturers see in their reports.</p>
        </div>
      </section>
      <AccountGate accountType="administrator">
        <AdministratorAttendanceWorkspace />
      </AccountGate>
    </div>
  );
}
