import type { Metadata } from 'next';
import { RetentionWorkspace } from '../../../components/retention-workspace';

export const metadata: Metadata = {
  title: 'Data retention',
  robots: { index: false, follow: false },
};

export default function RetentionPage() {
  return <RetentionWorkspace />;
}
