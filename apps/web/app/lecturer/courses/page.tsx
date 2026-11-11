import type { Metadata } from 'next';
import { AccountGate } from '../../../components/account-gate';
import { LecturerCoursesWorkspace } from '../../../components/course-workspaces';

export const metadata: Metadata = {
  title: 'Course tools',
  robots: { index: false, follow: false },
};

export default function LecturerCoursesPage() {
  return (
    <div className="page-stack lecturer-courses-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LECTURER WORKSPACE</p>
          <h1>Course tools</h1>
          <p className="page-lede">Create teaching offerings within your provisioned department, then issue and manage student enrollment codes.</p>
        </div>
      </section>
      <AccountGate accountType="lecturer">
        <LecturerCoursesWorkspace />
      </AccountGate>
    </div>
  );
}
