'use client';

import { AdministratorOverviewSchema, AuthenticatedSessionSchema } from '@lasuatos/contracts';
import type { AuthAdministrator } from '@lasuatos/contracts';
import {
  ArrowUpRight,
  BookOpenCheck,
  Building2,
  GraduationCap,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { loadAdministratorAttendanceOverview } from '../lib/attendance-api';
import { useEffect, useState } from 'react';

const roleLabels = {
  department_administrator: 'Department administrator',
  faculty_administrator: 'Faculty administrator',
  institution_administrator: 'Institution administrator',
} as const;

const numberFormat = new Intl.NumberFormat('en-NG');

export function AdministratorWorkspace() {
  const [workspace, setWorkspace] = useState<{
    readonly account: AuthAdministrator;
    readonly metrics: {
      readonly departments: number;
      readonly activeStudents: number;
      readonly activeLecturers: number;
      readonly courseOfferings: number;
      readonly activeEnrollments: number;
    };
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [attendance, setAttendance] = useState<Awaited<ReturnType<typeof loadAdministratorAttendanceOverview>>['totals'] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The attendance snapshot is supplementary; a failure must not hide the dashboard.
    void loadAdministratorAttendanceOverview(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setAttendance(result.totals); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const sessionResponse = await fetch('/api/v1/auth/session', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (sessionResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }
        if (!sessionResponse.ok) throw new Error('Your administrator account could not be confirmed.');

        const parsedSession = AuthenticatedSessionSchema.safeParse(await sessionResponse.json());
        if (!parsedSession.success) throw new Error('Your administrator account could not be confirmed.');
        if (parsedSession.data.account.accountType !== 'administrator') {
          const account = parsedSession.data.account;
          window.location.replace(account.accountType === 'student'
            ? '/courses'
            : account.accountType === 'lecturer'
              ? '/lecturer/courses'
              : '/admin');
          return;
        }

        const overviewResponse = await fetch('/api/v1/admin/overview', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (overviewResponse.status === 401) {
          window.location.replace('/sign-in');
          return;
        }
        if (overviewResponse.status === 403) {
          throw new Error('This account does not have administrator access.');
        }
        if (!overviewResponse.ok) throw new Error('The administration overview is temporarily unavailable.');

        const parsedOverview = AdministratorOverviewSchema.safeParse(await overviewResponse.json());
        if (!parsedOverview.success) throw new Error('The administration overview could not be loaded.');
        setWorkspace({ account: parsedSession.data.account, metrics: parsedOverview.data.metrics });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'The administration overview is temporarily unavailable.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadWorkspace();
    return () => controller.abort();
  }, [reloadKey]);

  if (loading) {
    return <div className="workspace-loading" role="status">Opening your administration workspace…</div>;
  }
  if (error || !workspace) {
    return (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>Administration is unavailable</h2>
          <p>{error || 'Your administrator account could not be loaded.'}</p>
          <div className="workspace-message-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setWorkspace(null);
                setError('');
                setLoading(true);
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </button>
            <Link className="button button-secondary" href="/">Return to LASUATOS</Link>
          </div>
        </div>
      </section>
    );
  }

  const { account, metrics } = workspace;
  const metricCards = [
    { label: 'Active departments', value: metrics.departments, icon: Building2 },
    { label: 'Student accounts', value: metrics.activeStudents, icon: GraduationCap },
    { label: 'Lecturer accounts', value: metrics.activeLecturers, icon: UsersRound },
    { label: 'Course offerings', value: metrics.courseOfferings, icon: BookOpenCheck },
    { label: 'Active enrollments', value: metrics.activeEnrollments, icon: ShieldCheck },
  ];

  return (
    <div className="admin-dashboard">
      <section className="admin-scope-card" aria-label="Administrator access scope">
        <div className="admin-scope-symbol"><ShieldCheck size={23} strokeWidth={1.7} aria-hidden="true" /></div>
        <div className="admin-scope-copy">
          <p className="section-kicker">YOUR ADMINISTRATIVE SCOPE</p>
          <h2>{account.scope.label}</h2>
          <p>
            {account.scope.type === 'department'
              ? `${account.scope.facultyName} · ${account.institutionName}`
              : account.scope.type === 'faculty'
                ? account.institutionName
                : `${account.institutionName} · University-wide`}
          </p>
        </div>
        <span className="admin-role-tag">{roleLabels[account.role]}</span>
      </section>

      <section className="admin-metric-grid" aria-label="Academic overview">
        {metricCards.map(({ label, value, icon: Icon }) => (
          <article className="admin-metric-card" key={label}>
            <div className="admin-metric-topline">
              <span>{label}</span>
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            </div>
            <strong>{numberFormat.format(value)}</strong>
            <p>Within your assigned scope</p>
          </article>
        ))}
      </section>

      <section className="admin-overview-panel">
        <div className="admin-overview-heading">
          <div>
            <p className="section-kicker">ATTENDANCE</p>
            <h2>Attendance overview</h2>
            <p>
              {attendance
                ? attendance.sessionsHeld
                  ? `${attendance.rate == null ? '—' : `${attendance.rate.toFixed(attendance.rate % 1 === 0 ? 0 : 1)}%`} attendance across ${numberFormat.format(attendance.sessionsHeld)} sessions in ${numberFormat.format(attendance.offeringsWithSessions)} course offerings · ${numberFormat.format(attendance.inconclusiveCheckIns)} inconclusive, ${numberFormat.format(attendance.manualCheckIns + attendance.revokedCheckIns)} lecturer corrections.`
                  : 'No attendance sessions have been held in your scope yet.'
                : 'Attendance rates by course offering, with evidence and correction counts, within your scope.'}
            </p>
          </div>
          <Link className="admin-directory-link" href="/admin/attendance">
            Open attendance overview
          </Link>
        </div>
      </section>

      <section className="admin-overview-panel">
        <div className="admin-overview-heading">
          <div>
            <p className="section-kicker">VENUES</p>
            <h2>Venue directory</h2>
            <p>
              Manage buildings and venues, register venue boundaries on site, and review which venues
              are ready for attendance verification.
            </p>
          </div>
          <Link className="admin-directory-link" href="/admin/venues">
            Open venue directory
          </Link>
        </div>
      </section>

      <section className="admin-overview-panel">
        <div className="admin-overview-heading">
          <div>
            <p className="section-kicker">LASU · FACULTY OF ENGINEERING</p>
            <h2>Academic overview</h2>
            <p>Keep a clear view of course setup and enrollment across the areas assigned to you.</p>
          </div>
          <span className="admin-live-indicator"><i aria-hidden="true" />Access verified</span>
        </div>
        <div className="admin-overview-steps">
          <article>
            <span className="admin-step-number">01</span>
            <div>
              <h3>Academic structure</h3>
              <p>Departments and course offerings are summarized using your current LASU access scope.</p>
            </div>
          </article>
          <article>
            <span className="admin-step-number">02</span>
            <div>
              <h3>People and enrollment</h3>
              <p>Student, lecturer and course enrollment totals update from the academic records in this workspace.</p>
            </div>
          </article>
          <article>
            <span className="admin-step-number">03</span>
            <div>
              <h3>Access stays scoped</h3>
              <p>Your administrator permissions are assigned by LASU and checked by the server for every request.</p>
            </div>
          </article>
        </div>
      </section>

      <div className="admin-dashboard-footer">
        <span>For Truth and Service</span>
        <Link className="text-link" href="/sign-in">
          Change account <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
