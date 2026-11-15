import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Courses } from '../../../components/courses/courses';

export const metadata: Metadata = {
  title: 'Course list',
  robots: { index: false, follow: false },
};

export default function AdminCoursesPage() {
  return (
    <Suspense>
      <Courses />
    </Suspense>
  );
}
