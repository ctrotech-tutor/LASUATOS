import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StudentRegistrationForm } from '../../components/account-forms';

export const metadata: Metadata = {
  title: 'Create student account',
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
          <h1>Create your student account.</h1>
          <p className="page-lede">Sign up once and your details are filled in whenever you mark attendance.</p>
        </div>
      </section>
      <StudentRegistrationForm />
      <p className="account-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
    </div>
  );
}
