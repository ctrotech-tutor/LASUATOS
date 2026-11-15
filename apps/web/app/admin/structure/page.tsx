import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Structure } from '../../../components/structure/structure';

export const metadata: Metadata = {
  title: 'Academic structure',
  robots: { index: false, follow: false },
};

export default function AdminStructurePage() {
  return (
    <Suspense>
      <Structure />
    </Suspense>
  );
}
