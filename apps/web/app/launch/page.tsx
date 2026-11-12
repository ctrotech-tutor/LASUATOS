import type { Metadata } from 'next';
import { LaunchRedirect } from '../../components/launch-redirect';

export const metadata: Metadata = {
  title: 'Opening LASUATOS',
  robots: { index: false, follow: false },
};

/** Start page of the installed app: goes straight to the right home for this account. */
export default function LaunchPage() {
  return <LaunchRedirect />;
}
