import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountGate } from '../../../components/account-gate';
import { LecturerDisputeWorkspace } from '../../../components/attendance-disputes';

export const metadata: Metadata = {
  title: 'Attendance disputes',
  robots: { index: false, follow: false },
};

export default function LecturerDisputesPage() {
  return (
    <div className="page-stack attendance-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LECTURER WORKSPACE</p>
          <h1>Attendance disputes</h1>
          <p className="page-lede">Review concerns students raise about missing or revoked check-ins in your courses. Uphold to record them present with an audited note, or reject with an explanation.</p>
        </div>
      </section>
      <AccountGate accountType="lecturer">
        {/* The workspace reads ?courseOfferingId= from the URL. */}
        <Suspense fallback={null}>
          <LecturerDisputeWorkspace />
        </Suspense>
      </AccountGate>
    </div>
  );
}
