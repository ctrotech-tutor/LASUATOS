import type { Metadata } from 'next';
import { ArrowLeft, Check, CircleDashed, LockKeyhole } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Setup checklist',
};

const setupItems = [
  {
    title: 'Application and API',
    description: 'The web workspace and versioned API health endpoints are in place.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'PostgreSQL connection',
    description: 'The schema is prepared. A managed database URL and a migration run are still required.',
    status: 'Not configured',
    tone: 'pending',
  },
  {
    title: 'LASU identity and account provisioning',
    description: 'An approved student and staff identity source has not been selected or connected.',
    status: 'Institutional decision required',
    tone: 'pending',
  },
  {
    title: 'Academic records',
    description: 'No faculties, departments, courses, offerings or enrolments have been imported.',
    status: 'No records loaded',
    tone: 'pending',
  },
  {
    title: 'Venue register',
    description: 'Venue coordinates and boundaries must be registered and reviewed on site.',
    status: 'Not configured',
    tone: 'pending',
  },
  {
    title: 'Attendance and verification',
    description: 'Session lifecycle, QR challenges and location verification are not enabled yet.',
    status: 'Not implemented',
    tone: 'pending',
  },
] as const;

export default function SetupPage() {
  return (
    <div className="page-stack setup-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Back to overview
      </Link>

      <section className="page-heading setup-heading">
        <div>
          <p className="page-eyebrow">PILOT READINESS</p>
          <h1>Before a live pilot</h1>
          <p className="page-lede">
            This build is a foundation workspace. It has no student records, and it cannot accept
            or confirm attendance.
          </p>
        </div>
        <span className="phase-badge">In progress</span>
      </section>

      <section className="setup-intro">
        <div className="setup-intro-icon"><LockKeyhole size={20} strokeWidth={1.8} aria-hidden="true" /></div>
        <div>
          <h2>Live check-in stays off until the foundations are verified.</h2>
          <p>
            Database access, university identity, venue ownership and retention rules need to be
            agreed with LASU before personal or location data is introduced.
          </p>
        </div>
      </section>

      <section className="checklist-panel" aria-labelledby="checklist-heading">
        <div className="panel-heading checklist-heading">
          <div>
            <p className="section-kicker">CURRENT BUILD</p>
            <h2 id="checklist-heading">Readiness checklist</h2>
          </div>
          <span className="quiet-tag">6 items</span>
        </div>

        <ol className="checklist">
          {setupItems.map((item, index) => (
            <li className="checklist-item" key={item.title}>
              <span className={`checklist-marker marker-${item.tone}`} aria-hidden="true">
                {item.tone === 'complete' ? <Check size={15} /> : <CircleDashed size={15} />}
              </span>
              <div className="checklist-main">
                <div className="checklist-title-row">
                  <h3>{item.title}</h3>
                  <span className={`checklist-status status-text-${item.tone}`}>{item.status}</span>
                </div>
                <p>{item.description}</p>
              </div>
              <span className="checklist-index" aria-label={`Item ${index + 1}`}>
                {String(index + 1).padStart(2, '0')}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="setup-note">
        <strong>Next engineering step:</strong> connect a PostgreSQL instance, apply the reviewed
        migration and build server-enforced authentication before importing any institutional data.
      </p>
    </div>
  );
}
