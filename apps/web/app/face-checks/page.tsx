import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FaceChecks } from '../../components/face-checks/face-checks';

export const metadata: Metadata = {
  title: 'Face checks',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function FaceChecksPage() {
  return (
    <Suspense>
      <FaceChecks />
    </Suspense>
  );
}
