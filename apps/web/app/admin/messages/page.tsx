import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Messages } from '../../../components/messages/messages';

export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false },
};

export default function ContactMessagesPage() {
  return (
    <Suspense>
      <Messages />
    </Suspense>
  );
}
