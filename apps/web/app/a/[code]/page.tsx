import type { Metadata } from 'next';
import { LectureCheckIn } from '../../../components/lecture-check-in';

export const metadata: Metadata = {
  title: 'Mark attendance',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** The link printed on a static QR poster: /a/K7M29QXD. */
export default async function PosterCheckInPage({ params }: Readonly<{ params: Promise<{ code: string }> }>) {
  const { code } = await params;
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return <LectureCheckIn initialCode={normalized} />;
}
