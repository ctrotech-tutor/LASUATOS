import type { Metadata } from 'next';
import { StudentSetupFlow } from '../../../components/student-onboarding';

export const metadata: Metadata = {
  title: 'Finish setting up',
  robots: { index: false, follow: false },
};

/** Confirm the LASU email and register the face, one step per screen; each step titles itself. */
export default function StudentSetupPage() {
  return (
    <div className="obf-page">
      <StudentSetupFlow />
    </div>
  );
}
