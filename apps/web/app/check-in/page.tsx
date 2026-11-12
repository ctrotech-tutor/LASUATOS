import type { Metadata } from 'next';
import { CheckInLanding } from '../../components/check-in-landing';

export const metadata: Metadata = {
  title: 'Check in',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function CheckInPage() {
  return (
    <div className="page-stack checkin-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ATTENDANCE CHECK-IN</p>
          <h1>Lecture check-in</h1>
        </div>
      </section>
      <CheckInLanding />
    </div>
  );
}
