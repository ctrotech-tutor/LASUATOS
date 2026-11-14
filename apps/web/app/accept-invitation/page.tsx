import type { Metadata, Viewport } from 'next';
import { AcceptInvitationForm } from '../../components/accept-invitation';
import { AuthLayout } from '../../components/auth/auth-layout';

export const metadata: Metadata = {
  title: 'Accept your staff invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { themeColor: '#0c2236' };

export default function AcceptInvitationPage() {
  return (
    <AuthLayout
      story="accept-invitation"
      eyebrow="Staff invitation"
      title="Accept your invitation."
      lede="Choose a password to activate your lecturer or administrator account. You’re signed in straight away."
    >
      <AcceptInvitationForm />
    </AuthLayout>
  );
}
