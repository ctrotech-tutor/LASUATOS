import type { Metadata, Viewport } from 'next';
import { AuthLayout } from '../../../components/auth/auth-layout';
import { SignedInPasswordHelp } from '../../../components/auth/signed-in';

export const metadata: Metadata = {
  title: 'Password help',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0c2236' };

/**
 * Password help for a signed-in visitor. proxy.ts shows this page at /forgot-password (the address
 * does not change) when the browser is signed in, so the reset form never flashes up first.
 */
export default function SignedInPasswordHelpPage() {
  return (
    <AuthLayout
      story="forgot-password"
      eyebrow="Password help"
      title="You’re signed in already."
      lede="Change your password from your account, or have a reset link emailed to you if you no longer know it."
    >
      <SignedInPasswordHelp />
    </AuthLayout>
  );
}
