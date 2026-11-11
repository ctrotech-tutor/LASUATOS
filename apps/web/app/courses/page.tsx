import type { Metadata } from 'next';
import { StudentCoursesWorkspace } from '../../components/course-workspaces';

export const metadata: Metadata = {
  title: 'My courses',
  robots: { index: false, follow: false },
};

export default function StudentCoursesPage() {
  return (
    <div className="page-stack courses-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">STUDENT WORKSPACE</p>
          <h1>My courses</h1>
          <p className="page-lede">Join a course with a code from your lecturer and keep track of your current course enrollments.</p>
        </div>
      </section>
      <StudentCoursesWorkspace />
    </div>
  );
}
