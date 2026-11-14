import type { Metadata } from 'next';
import { ContactInboxWorkspace } from '../../../components/contact-inbox';

export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false },
};

export default function ContactMessagesPage() {
  return <ContactInboxWorkspace />;
}
