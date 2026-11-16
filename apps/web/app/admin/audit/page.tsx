import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditLog } from '../../../components/audit/audit';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
