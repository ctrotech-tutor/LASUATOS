import type { Metadata } from 'next';
import { EmailVerification } from '../../components/account-forms';

export const metadata: Metadata = {
  title: 'Confirm email address',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function VerifyEmailPage() {
  return (
    <div className="page-stack account-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Confirm your email</h1>
          <p className="page-lede">Confirm the email address on your student account to continue to LASUATOS.</p>
        </div>
      </section>
      <EmailVerification />
    </div>
  );
}
