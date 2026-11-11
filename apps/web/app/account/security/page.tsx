import type { Metadata } from 'next';
import { AccountSecurity } from '../../../components/account-security';

export const metadata: Metadata = {
  title: 'Account security',
  robots: { index: false, follow: false },
};

export default function AccountSecurityPage() {
  return (
    <div className="page-stack account-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">LASUATOS ACCOUNT</p>
          <h1>Account security</h1>
          <p className="page-lede">Review where you are signed in, sign out sessions you do not recognise and change your password.</p>
        </div>
      </section>
      <AccountSecurity />
    </div>
  );
}
