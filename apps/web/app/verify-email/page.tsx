import type { Metadata, Viewport } from 'next';
import { EmailVerification } from '../../components/account-forms';
import { AuthLayout } from '../../components/auth/auth-layout';

export const metadata: Metadata = {
  title: 'Confirm email address',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { themeColor: '#0c2236' };

export default function VerifyEmailPage() {
  return (
    <AuthLayout
      story="verify-email"
      eyebrow="Email confirmation"
      title="Confirm your email."
      lede="Confirm the email address on your student account to continue to LASUATOS."
    >
      <EmailVerification />
    </AuthLayout>
  );
}
