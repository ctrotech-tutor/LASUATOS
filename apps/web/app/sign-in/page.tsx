import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AccountLoginForm } from '../../components/account-forms';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <div className="page-stack account-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Back to LASUATOS
      </Link>
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Welcome back.</h1>
          <p className="page-lede">Sign in once. LASUATOS opens the student, lecturer or administrator workspace assigned to your account.</p>
        </div>
      </section>
      <AccountLoginForm />
      <p className="account-switch">New student? <Link href="/sign-up">Open your account with your matric number</Link></p>
    </div>
  );
}
