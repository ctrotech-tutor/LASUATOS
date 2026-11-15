import type { Metadata } from 'next';
import { AdminOverview } from '../../components/admin-overview/admin-overview';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

export default function AdministratorPage() {
  return <AdminOverview />;
}
