import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Retention } from '../../../components/retention/retention';

export const metadata: Metadata = {
  title: 'Data retention',
  robots: { index: false, follow: false },
};

export default function RetentionPage() {
  return (
    <Suspense>
      <Retention />
    </Suspense>
  );
}
