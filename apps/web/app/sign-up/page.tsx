import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StudentOnboarding } from '../../components/student-onboarding';

export const metadata: Metadata = {
  title: 'Open your student account',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <div className="page-stack account-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Back to LASUATOS
      </Link>
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Open your student account.</h1>
          <p className="page-lede">Just your matric number, a code to your LASU email, and three quick photos. About two minutes.</p>
        </div>
      </section>
      <StudentOnboarding />
      <p className="account-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
    </div>
  );
}
