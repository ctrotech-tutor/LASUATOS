import type { Metadata } from 'next';
import { StudentSetupFlow } from '../../../components/student-onboarding';

export const metadata: Metadata = {
  title: 'Finish setting up',
  robots: { index: false, follow: false },
};

export default function StudentSetupPage() {
  return (
    <div className="page-stack account-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Finish setting up.</h1>
          <p className="page-lede">Confirm your LASU email and register your face, so only you can mark your attendance.</p>
        </div>
      </section>
      <StudentSetupFlow />
    </div>
  );
}
