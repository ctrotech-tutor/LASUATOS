import type { Metadata } from 'next';
import { PasswordResetForm } from '../../components/account-security';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetPasswordPage() {
  return (
    <div className="page-stack account-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Reset your password</h1>
          <p className="page-lede">Choose a new password for your LASUATOS account.</p>
        </div>
      </section>
      <PasswordResetForm />
    </div>
  );
}
