import type { Metadata } from 'next';
import { AdministratorWorkspace } from '../../components/administrator-workspace';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

export default function AdministratorPage() {
  return (
    <div className="page-stack admin-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASU ADMINISTRATION</p>
          <h1>Administration</h1>
          <p className="page-lede">
            A focused overview of the academic areas and course activity within your assigned scope.
          </p>
        </div>
      </section>
      <AdministratorWorkspace />
    </div>
  );
}
