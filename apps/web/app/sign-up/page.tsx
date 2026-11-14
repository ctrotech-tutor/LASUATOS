import type { Metadata, Viewport } from 'next';
import { LogIn } from 'lucide-react';
import { AuthLayout, AuthSwitch } from '../../components/auth/auth-layout';
import { SignedInRedirect } from '../../components/auth/signed-in';
import { StudentOnboarding } from '../../components/student-onboarding';

export const metadata: Metadata = {
  title: 'Open your student account',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0c2236' };

export default function SignUpPage() {
  return (
    <AuthLayout
      story="sign-up"
      eyebrow="New student"
      title="Open your account."
      lede="Your matric number, a code to your LASU email and three quick photos. About two minutes."
      footer={<AuthSwitch href="/sign-in" prompt="Already have an account?" action="Sign in" icon={<LogIn size={20} />} />}
    >
      <SignedInRedirect>
        <StudentOnboarding />
      </SignedInRedirect>
    </AuthLayout>
  );
}
