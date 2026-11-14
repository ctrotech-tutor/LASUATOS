import type { Metadata } from 'next';
import { AuditLogWorkspace } from '../../../components/audit-log-workspace';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

export default function AuditLogPage() {
  return <AuditLogWorkspace />;
}
