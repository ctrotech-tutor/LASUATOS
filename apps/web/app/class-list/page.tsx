import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassLists } from '../../components/class-lists/class-lists';

export const metadata: Metadata = {
  title: 'Class lists',
  robots: { index: false, follow: false },
};

export default function ClassListPage() {
  return (
    <Suspense>
      <ClassLists />
    </Suspense>
  );
}
