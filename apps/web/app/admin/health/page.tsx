import type { Metadata } from 'next';
import { SystemHealthPage } from '../../../components/health/health';

export const metadata: Metadata = {
  title: 'System health',
  robots: { index: false, follow: false },
};

export default function HealthPage() {
  return <SystemHealthPage />;
}
