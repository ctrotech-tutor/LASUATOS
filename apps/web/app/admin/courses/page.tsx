import type { Metadata } from 'next';
import { CourseDirectoryWorkspace } from '../../../components/course-directory-workspace';

export const metadata: Metadata = {
  title: 'Course list · LASUATOS administration',
  description: 'Correct course codes, titles and units, hide old courses, and rename a code prefix.',
};

export default function AdminCoursesPage() {
  return <CourseDirectoryWorkspace />;
}
