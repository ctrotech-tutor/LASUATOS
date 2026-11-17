import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Assistants } from '../../components/class-reps/assistants';

export const metadata: Metadata = {
  title: 'Assistants',
  robots: { index: false, follow: false },
};

export default function AssistantsPage() {
  return (
    <Suspense>
      <Assistants />
    </Suspense>
  );
}
