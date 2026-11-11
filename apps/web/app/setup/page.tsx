import type { Metadata } from 'next';
import { ArrowLeft, ArrowRight, Check, CircleDashed, FileSpreadsheet, LockKeyhole } from 'lucide-react';
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
    title: 'Student accounts and email delivery',
    description: 'Self-registration and mailbox confirmation are implemented. A database, existing institution row and server-side email sender are still required. These steps do not verify LASU student status.',
    status: 'Not configured',
    tone: 'pending',
  },
  {
    title: 'Course offerings and enrollment',
    description: 'Lecturer course creation and same-institution student enrollment are implemented. A database migration and provisioned lecturer account are required; local sample records are synthetic only.',
    status: 'Database required',
    tone: 'pending',
  },
  {
    title: 'Academic records',
    description: 'No official academic records are loaded. A local roster preflight is available, but it does not import or verify records.',
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
        <ArrowLeft size={16} aria-hidden="true" /> Back to LASUATOS
      </Link>

      <section className="page-heading setup-heading">
        <div>
          <p className="page-eyebrow">PILOT READINESS</p>
          <h1>Before a live pilot</h1>
          <p className="page-lede">
            This build is a foundation workspace. It contains no official student records and cannot
            accept or confirm attendance.
          </p>
        </div>
        <span className="phase-badge">In progress</span>
      </section>

      <section className="setup-intro">
        <div className="setup-intro-icon"><LockKeyhole size={20} strokeWidth={1.8} aria-hidden="true" /></div>
        <div>
          <h2>Live check-in stays off until the foundations are verified.</h2>
          <p>
            The account flow confirms email ownership only. A development database, approved data
            purpose and retention rules are still needed before real student or location data is used.
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
          <span className="quiet-tag">7 items</span>
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
        <strong>Next product gate:</strong> apply the reviewed migration on the guarded local database
        and exercise the synthetic lecturer-to-student enrollment flow. A live pilot still needs approved
        academic data, venue registration, attendance verification and a reviewed roster-import path.
      </p>
    </div>
  );
}
