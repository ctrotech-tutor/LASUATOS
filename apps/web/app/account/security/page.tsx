import type { Metadata } from 'next';
import { AccountSettings } from '../../../components/account/account';

export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountSettings />;
}
