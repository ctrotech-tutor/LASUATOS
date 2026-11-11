import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ForgotPasswordForm } from '../../components/account-security';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="page-stack account-page">
      <Link className="back-link" href="/sign-in">
        <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
      </Link>
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Forgot your password?</h1>
          <p className="page-lede">Students, lecturers and administrators can reset a password from the email address on their account.</p>
        </div>
      </section>
      <ForgotPasswordForm />
    </div>
  );
}
