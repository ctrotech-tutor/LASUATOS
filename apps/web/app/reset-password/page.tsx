import type { Metadata, Viewport } from 'next';
import { AuthLayout } from '../../components/auth/auth-layout';
import { PasswordResetForm } from '../../components/account-security';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { themeColor: '#0c2236' };

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      story="reset-password"
      eyebrow="Password help"
      title="Choose a new password."
      lede="Saving it signs you out on every other phone and computer, including any you no longer use."
    >
      <PasswordResetForm />
    </AuthLayout>
  );
}
