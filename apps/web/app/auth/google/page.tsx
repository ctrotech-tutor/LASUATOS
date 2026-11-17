import type { Metadata } from 'next';
import { GoogleReturn } from '../../../components/onboarding/google-return';

export const metadata: Metadata = {
  title: 'Back from Google',
  robots: { index: false, follow: false },
  // Google's answer is in the address fragment, which browsers never send on; this keeps
  // even the page's own address out of anything it links to.
  referrer: 'no-referrer',
};

/** Where Google sends the student back after "Continue with Google" (ADR 027). */
export default function GoogleReturnPage() {
  return <GoogleReturn />;
}
