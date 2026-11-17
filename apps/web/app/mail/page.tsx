import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountGate } from '../../components/account-gate';
import { LasuMail } from '../../components/lasu-mail/lasu-mail';

export const metadata: Metadata = {
  title: 'LASU mail',
  robots: { index: false, follow: false },
};

export default function LasuMailPage() {
  return (
    <AccountGate accountType="student">
      <Suspense>
        <LasuMail />
      </Suspense>
    </AccountGate>
  );
}
