import type { Metadata, Viewport } from 'next';
import { AuthLayout } from '../../components/auth/auth-layout';
import { ForgotPasswordForm } from '../../components/account-security';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0c2236' };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      story="forgot-password"
      eyebrow="Password help"
      title="Forgot your password?"
      lede="Type the email you sign in with or, for students, your matric number. We’ll email you a single-use link to choose a new one."
      back={{ href: '/sign-in', label: 'Back to sign in' }}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
