import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Staff } from '../../../components/staff/staff';

export const metadata: Metadata = {
  title: 'Staff · LASUATOS',
  description: 'Lecturers and administrators: who uses LASUATOS, who is still to join, and their access.',
  robots: { index: false, follow: false },
};

export default function AdminStaffPage() {
  return (
    <Suspense>
      <Staff />
    </Suspense>
  );
}
