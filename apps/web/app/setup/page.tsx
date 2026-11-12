import type { Metadata } from 'next';
import { ArrowLeft, ArrowRight, Check, CircleDashed, FileSpreadsheet, LockKeyhole } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Setup checklist',
};

const setupItems = [
  {
    title: 'Application, API and database',
    description: 'The web workspace, versioned API and PostgreSQL schema are deployed. Run the migration command after every update that adds a migration.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'Student accounts and email delivery',
    description: 'Students sign up with their matric number and confirm their mailbox; password reset and invitations are emailed. Accounts confirm email ownership only — they do not verify LASU student status.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'Courses, lecturers and enrollment',
    description: 'Administrators invite lecturers; lecturers create course offerings and share join codes; students enroll themselves.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'Rotating QR check-in',
    description: 'Lecturers project a QR code that changes every 20 seconds; students scan it with their phone camera or the in-app scanner. QR-only sessions refuse typed codes, and the roster flags one browser checking in several students.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'Student level from matric number',
    description: 'Level is worked out from the entry year in the matric number and the current academic session, capped by the programme length. It is shown for information only and never decides access.',
    status: 'Implemented',
    tone: 'complete',
  },
  {
    title: 'Venue register',
    description: 'Venue coordinates and boundaries must be captured on site by an administrator before location evidence can be attached to check-ins.',
    status: 'Needs on-site work',
    tone: 'pending',
  },
  {
    title: 'Official academic records',
    description: 'No official LASU records are loaded, and matric numbers are self-reported. A local roster preflight is available, but it does not import or verify records.',
    status: 'Out of scope',
    tone: 'pending',
  },
] as const;

export default function SetupPage() {
  return (
    <div className="page-stack setup-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Back to LASUATOS
      </Link>

      <section className="page-heading setup-heading">
        <div>
          <p className="page-eyebrow">PILOT READINESS</p>
          <h1>Before a live pilot</h1>
          <p className="page-lede">
            LASUATOS records lecture attendance with rotating QR codes and optional venue location
            evidence. This page lists what is ready and what still needs work on site.
          </p>
        </div>
        <span className="phase-badge">Pilot ready</span>
      </section>

      <section className="setup-intro">
        <div className="setup-intro-icon"><LockKeyhole size={20} strokeWidth={1.8} aria-hidden="true" /></div>
        <div>
          <h2>Evidence, not surveillance.</h2>
          <p>
            Location is read only at the moment of check-in and only for venue-linked sessions. Device
            signals are per-session hashes that cannot be linked across lectures. Agree a data purpose and
            retention period with the department before a wide rollout.
          </p>
        </div>
      </section>

      <section className="roster-entry-card" aria-labelledby="roster-entry-heading">
        <span className="roster-entry-icon"><FileSpreadsheet size={19} aria-hidden="true" /></span>
        <div>
          <p className="section-kicker">ACADEMIC DATA PREPARATION</p>
          <h2 id="roster-entry-heading">Check a department course roster</h2>
          <p>
            Run a local structure check on a CSV export before an approved data-import workflow exists.
            The file is not uploaded, and a clean result does not confirm LASU registration.
          </p>
        </div>
        <Link className="text-link roster-entry-link" href="/setup/roster">
          Open roster preflight <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="checklist-panel" aria-labelledby="checklist-heading">
        <div className="panel-heading checklist-heading">
          <div>
            <p className="section-kicker">CURRENT BUILD</p>
            <h2 id="checklist-heading">Readiness checklist</h2>
          </div>
          <span className="quiet-tag">{setupItems.length} items</span>
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
        <strong>Next step for a pilot:</strong> register the lecture venues on site, then run one real
        lecture end to end — project the QR code, have students scan it, and review the roster and report
        afterwards.
      </p>
    </div>
  );
}
