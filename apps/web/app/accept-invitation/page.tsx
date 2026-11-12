import type { Metadata } from 'next';
import { AcceptInvitationForm } from '../../components/accept-invitation';

export const metadata: Metadata = {
  title: 'Accept your staff invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function AcceptInvitationPage() {
  return (
    <div className="page-stack account-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS STAFF</p>
          <h1>Accept your invitation</h1>
          <p className="page-lede">Set a password to activate your lecturer or administrator account.</p>
        </div>
      </section>
      <AcceptInvitationForm />
    </div>
  );
}
