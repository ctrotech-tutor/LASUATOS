import type { Metadata } from 'next';
import { FaceReviewsWorkspace } from '../../components/face-reviews-workspace';

export const metadata: Metadata = {
  title: 'Face checks',
  robots: { index: false, follow: false },
};

export default function FaceChecksPage() {
  return <FaceReviewsWorkspace />;
}
