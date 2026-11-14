import type { Metadata, Viewport } from 'next';
import { UserRoundPlus } from 'lucide-react';
import { AccountLoginForm } from '../../components/account-forms';
import { AuthLayout, AuthSwitch } from '../../components/auth/auth-layout';
import { SignedInRedirect } from '../../components/auth/signed-in';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

// The phone status bar matches the navy band at the top of the page.
export const viewport: Viewport = { themeColor: '#0c2236' };

export default function SignInPage() {
  return (
    <AuthLayout
      story="sign-in"
      eyebrow="Students · Class reps · Staff"
      title="Welcome back."
      lede="One sign-in for everyone. LASUATOS opens the right workspace for your account."
      footer={<AuthSwitch href="/sign-up" prompt="New student?" action="Open your account with your matric number" icon={<UserRoundPlus size={20} />} />}
    >
      <SignedInRedirect>
        <AccountLoginForm />
      </SignedInRedirect>
    </AuthLayout>
  );
}
