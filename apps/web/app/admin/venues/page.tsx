import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Venues } from '../../../components/venues/venues';

export const metadata: Metadata = {
  title: 'Venues',
  robots: { index: false, follow: false },
};

export default function AdminVenuesPage() {
  return (
    <Suspense>
      <Venues />
    </Suspense>
  );
}
