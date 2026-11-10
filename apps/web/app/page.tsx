import {
  ArrowRight,
  BookOpenCheck,
  MapPin,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { SystemStatus } from '../components/system-status';

const workspaceStates = [
  {
    label: 'Active sessions',
    value: 'Not connected',
    note: 'Attendance sessions are not enabled',
    icon: BookOpenCheck,
  },
  {
    label: 'Registered venues',
    value: 'Not configured',
    note: 'No approved venue locations are loaded',
    icon: MapPin,
  },
  {
    label: 'Verified accounts',
    value: 'Not connected',
    note: 'No LASU identity source is linked',
    icon: UsersRound,
  },
] as const;

export default function OverviewPage() {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">PILOT WORKSPACE</p>
          <h1>Attendance operations</h1>
          <p className="page-lede">
            A dependable lecture record starts with verified courses, a registered venue and a
            check-in the server can confirm.
          </p>
        </div>
        <span className="phase-badge">Preparation</span>
      </section>

      <section className="notice-banner" aria-labelledby="notice-title">
        <div className="notice-symbol"><ShieldCheck size={21} strokeWidth={1.8} aria-hidden="true" /></div>
        <div className="notice-copy">
          <p className="notice-label">NO LIVE RECORDS</p>
          <h2 id="notice-title">This workspace is not connected to LASU systems.</h2>
          <p>
            There are no student records or active check-ins here. Attendance will stay disabled
            until the approved identity source, database and venue register are configured.
          </p>
        </div>
        <Link className="text-link notice-link" href="/setup">
          Review setup <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="summary-grid" aria-label="Workspace data availability">
        {workspaceStates.map(({ label, value, note, icon: Icon }) => (
          <article className="summary-item" key={label}>
            <div className="summary-topline">
              <span>{label}</span>
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            </div>
            <strong className="summary-value">{value}</strong>
            <p>{note}</p>
          </article>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="empty-panel" aria-labelledby="sessions-title">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">ATTENDANCE</p>
              <h2 id="sessions-title">Live sessions</h2>
            </div>
            <span className="quiet-tag">No data source</span>
          </div>
          <div className="empty-state">
            <div className="empty-icon"><BookOpenCheck size={22} strokeWidth={1.7} aria-hidden="true" /></div>
            <h3>No sessions to show</h3>
            <p>
              Live lecture sessions will appear here after academic data and the attendance service
              are connected.
            </p>
            <Link className="text-link" href="/setup">
              See what is needed <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel-footnote">
            The current build cannot create, verify or confirm attendance.
          </div>
        </section>

        <SystemStatus />
      </div>

      <section className="pilot-scope">
        <div className="scope-marker" aria-hidden="true" />
        <div>
          <p className="section-kicker">PLANNED FIRST DEPLOYMENT</p>
          <h2>Lagos State University, Faculty of Engineering</h2>
          <p>
            The data model is being designed for multiple faculties, departments, campuses and
            institutions. This is a target scope, not an active deployment.
          </p>
        </div>
        <Link className="text-link scope-link" href="/setup">
          View readiness <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
