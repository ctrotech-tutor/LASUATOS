'use client';

import type { HealthEmailProvider, SystemHealth } from '@lasuatos/contracts';
import { Activity, BellRing, CheckCircle2, Database, KeyRound, Mail, MoonStar, OctagonAlert, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { lookupAdministrator } from '../../lib/current-account';
import { loadSystemHealth } from '../../lib/health-api';
import { useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, Menu, PageHeader, Section } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import {
  ALERT_LABEL, alertTone, bars, dayLabel, FAILURE_LABEL, HEALTH_KEY, OVERALL_TITLE, overallLine, PATH, plural, problems, providerName, SIGNAL_LABEL,
  signalShare, since, stateLine, usageLine, usageShare, when,
} from './format';
import './health.css';

type Answer = { readonly kind: 'ok' } | { readonly kind: 'denied'; readonly message: string };

const WHO_KEY = 'admin:health-who';

async function loadWho(): Promise<Answer> {
  const session = await lookupAdministrator('see system health');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  if (session.account.role !== 'institution_administrator') {
    return { kind: 'denied', message: 'System health is for institution administrators, who get the alert emails too. Ask one of them if something seems wrong.' };
  }
  return { kind: 'ok' };
}

const loadHealth = (signal: AbortSignal) => loadSystemHealth(signal);

/**
 * System health: whether students can sign in, get their codes and check in right now.
 * One answer at the top, then the database, each email provider in the order they are
 * tried (with today's allowance and the last week), the trends that raise alerts, the
 * recent alerts and the nightly clean-up. Refreshes every minute.
 */
export function SystemHealthPage() {
  const who = useResource(WHO_KEY, loadWho, { maxAge: 60_000 });
  const answer = who.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="hl">
        <PageHeader title="System health" />
        <div className="ds-card">
          <EmptyState icon={<ShieldCheck size={26} strokeWidth={1.9} />} title="System health is for institution administrators" message={answer.message} action={<Button href="/" variant="tinted">Go home</Button>} />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="hl">
        <PageHeader title="System health" />
        {who.error ? (
          <div className="ds-card">
            <EmptyState error title="System health did not load" message={who.error} action={<Button variant="tinted" onClick={who.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Report />;
}

function Report() {
  const health = useResource(HEALTH_KEY, loadHealth, { maxAge: 15_000, poll: 60_000 });
  const now = useClock('fifteen');
  const data = health.data;

  const header = (
    <PageHeader
      title="System health"
      subtitle={data ? `Checked ${when(data.checkedAt, now || Date.parse(data.checkedAt))}` : undefined}
      actions={(
        <div className="hl-head-actions">
          <GuideButton page={PATH} label="System health" />
          <Menu label="More actions" items={[{ label: 'Check again', icon: <RefreshCw size={17} />, onSelect: health.reload }]} />
        </div>
      )}
    />
  );

  if (!data) {
    return (
      <div className="hl">
        {header}
        {health.error ? (
          <div className="ds-card">
            <EmptyState error title="System health did not load" message={health.error} action={<Button variant="tinted" onClick={health.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }

  const at = now || Date.parse(data.checkedAt);
  return (
    <div className="hl">
      {header}
      <Overall health={data} now={at} />
      <div className="hl-grid">
        <div className="hl-col">
          <EmailSection health={data} now={at} />
          <SignalsSection health={data} />
        </div>
        <div className="hl-col">
          <AlertsSection health={data} now={at} />
          <ServicesSection health={data} now={at} />
        </div>
      </div>
    </div>
  );
}

function Overall({ health, now }: Readonly<{ health: SystemHealth; now: number }>) {
  const list = problems(health, now);
  const Icon = health.overall === 'ok' ? CheckCircle2 : health.overall === 'down' ? OctagonAlert : TriangleAlert;
  return (
    <section className={`hl-overall is-${health.overall}`} aria-labelledby="hl-overall-title" aria-live="polite">
      <span className="hl-overall-icon" aria-hidden="true"><Icon size={22} strokeWidth={2.1} /></span>
      <div className="hl-overall-body">
        <h2 className="hl-overall-title" id="hl-overall-title">{OVERALL_TITLE[health.overall]}</h2>
        <p className="hl-overall-line">{overallLine(health, now)}</p>
        {list.length ? (
          <ul className="hl-problems">
            {list.map((problem) => (
              <li key={problem.text} className={`is-${problem.tone}`}>
                <span className="hl-dot" aria-hidden="true" />
                <span><span className="sr-only">{problem.tone === 'down' ? 'Urgent: ' : 'Needs a look: '}</span>{problem.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function EmailSection({ health, now }: Readonly<{ health: SystemHealth; now: number }>) {
  const { email } = health;
  return (
    <Section
      id="hl-email"
      title="Email"
      aside={email.configured ? `${plural(email.providers.length, 'provider')}, tried in this order` : undefined}
      footer={email.configured
        ? 'Allowances reset at 1:00 am Lagos time (midnight UTC). A provider that refuses is skipped for a while, and every instance of LASUATOS skips it too.'
        : undefined}
    >
      {email.configured ? (
        <ol className="hl-providers">
          {email.providers.map((provider, index) => (
            <ProviderCard key={provider.provider} provider={provider} position={index + 1} current={email.current === provider.provider} days={email.days} now={now} />
          ))}
        </ol>
      ) : (
        <div className="ds-card">
          <EmptyState icon={<Mail size={26} strokeWidth={1.9} />} title="No email provider is set up" message="Set EMAIL_PROVIDER (with its key) in Vercel, plus GMAIL_USER and GMAIL_APP_PASSWORD as the backup, then redeploy." />
        </div>
      )}
    </Section>
  );
}

function ProviderCard({ provider, position, current, days, now }: Readonly<{
  provider: HealthEmailProvider;
  position: number;
  current: boolean;
  days: readonly string[];
  now: number;
}>) {
  const name = providerName(provider.provider);
  const share = usageShare(provider);
  const state = stateLine(provider, now);
  const heights = bars(provider.history, provider.limit);
  const meterTone = share === null ? '' : share >= 1 ? ' is-full' : share >= 0.9 ? ' is-near' : '';
  const badge = current
    ? <Badge tone="success" dot>Sending now</Badge>
    : provider.state === 'ready'
      ? <Badge>Standby</Badge>
      : <Badge tone={provider.state === 'full' ? 'warning' : 'danger'}>{provider.state === 'full' ? 'Allowance used' : 'Skipped'}</Badge>;
  return (
    <li className={`hl-provider is-${provider.state}${current ? ' is-current' : ''}`} aria-labelledby={`hl-provider-${provider.provider}`}>
      <div className="hl-provider-head">
        <span className="hl-provider-order" aria-hidden="true">{position}</span>
        <h3 className="hl-provider-name" id={`hl-provider-${provider.provider}`}>
          {name}
          <span className="sr-only">, {position === 1 ? 'main provider' : `backup ${position - 1}`}</span>
        </h3>
        <span className="hl-provider-role">{provider.role === 'primary' ? 'Main' : 'Backup'}</span>
        {badge}
      </div>

      <div className="hl-usage">
        <span className="hl-usage-text">{usageLine(provider)}</span>
        {provider.failedToday ? <span className="hl-usage-failed">{plural(provider.failedToday, 'refusal')}</span> : null}
      </div>
      {share !== null ? (
        <div
          className={`hl-meter${meterTone}`}
          role="meter"
          aria-label={`${name} allowance used today`}
          aria-valuemin={0}
          aria-valuemax={provider.limit ?? 0}
          aria-valuenow={provider.sentToday}
          aria-valuetext={usageLine(provider)}
        >
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      ) : null}

      {state ? <p className="hl-provider-state">{state}</p> : null}

      {provider.history.some((count) => count > 0) ? (
        <figure className="hl-spark">
          <div className="hl-spark-bars" aria-hidden="true">
            {heights.map((height, index) => (
              <span key={days[index] ?? index} style={{ height: `${Math.max(height * 100, provider.history[index] ? 6 : 2)}%` }} title={`${dayLabel(days[index] ?? '')}: ${provider.history[index] ?? 0}`} />
            ))}
          </div>
          <figcaption className="sr-only">
            Sent in the last {days.length} days: {days.map((day, index) => `${dayLabel(day)} ${provider.history[index] ?? 0}`).join(', ')}.
          </figcaption>
          <figcaption className="hl-spark-caption" aria-hidden="true">Last {days.length} days</figcaption>
        </figure>
      ) : null}

      <dl className="hl-facts">
        <div>
          <dt>Last sent</dt>
          <dd>{provider.lastSuccessAt ? since(provider.lastSuccessAt, now) : 'Not yet'}</dd>
        </div>
        {provider.lastFailureAt ? (
          <div className="is-wide">
            <dt>Last refusal</dt>
            <dd>
              {when(provider.lastFailureAt, now)}{provider.lastFailureKind ? `, ${FAILURE_LABEL[provider.lastFailureKind]}` : ''}
              {provider.lastFailureReason ? <span className="hl-reason">{provider.lastFailureReason}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

function SignalsSection({ health }: Readonly<{ health: SystemHealth }>) {
  return (
    <Section id="hl-signals" title="Trends" aside="Alert when a bar fills" footer="Counted across every instance. One alert per trend per hour at most.">
      <ul className="ds-card hl-signals">
        {health.signals.map((signal) => {
          const share = signalShare(signal);
          const label = SIGNAL_LABEL[signal.signal];
          return (
            <li key={signal.signal} className={share >= 1 ? 'is-over' : share >= 0.5 ? 'is-rising' : ''}>
              <div className="hl-signal-head">
                <span className="hl-signal-title">{label.title}</span>
                <span className="hl-signal-count">{signal.count} <span className="hl-signal-of">/ {signal.threshold}</span></span>
              </div>
              <div
                className="hl-meter is-thin"
                role="meter"
                aria-label={`${label.title} in the last ${signal.windowMinutes} minutes`}
                aria-valuemin={0}
                aria-valuemax={signal.threshold}
                aria-valuenow={Math.min(signal.count, signal.threshold)}
                aria-valuetext={`${signal.count} ${label.unit} in ${signal.windowMinutes} minutes; alert at ${signal.threshold}`}
              >
                <span style={{ width: `${Math.round(share * 100)}%` }} />
              </div>
              <span className="hl-signal-window">Last {signal.windowMinutes} minutes</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function AlertsSection({ health, now }: Readonly<{ health: SystemHealth; now: number }>) {
  const { email } = health;
  const where = email.alertsEmailing
    ? `Emailed to ${plural(email.alertRecipients, 'address', 'addresses')} in ALERT_EMAIL`
    : email.alertRecipients ? 'ALERT_EMAIL is set, but no email provider is' : 'ALERT_EMAIL is not set, so alerts are only logged';
  return (
    <Section id="hl-alerts" title="Recent alerts" aside={<span className={email.alertsEmailing ? '' : 'hl-warn'}>{where}</span>}>
      {health.alerts.length ? (
        <ul className="ds-card hl-alerts">
          {health.alerts.map((alert) => (
            <li key={alert.id} className={`is-${alertTone(alert.kind)}`}>
              <span className="hl-dot" aria-hidden="true" />
              <div className="hl-alert-body">
                <span className="hl-alert-kind">{ALERT_LABEL[alert.kind]}</span>
                <span className="hl-alert-summary">{alert.summary}</span>
              </div>
              <span className="hl-alert-meta">
                <time dateTime={alert.occurredAt}>{when(alert.occurredAt, now)}</time>
                <span>{alert.outcome === 'emailed' ? 'Emailed' : alert.outcome === 'throttled' ? 'Repeat, not emailed' : 'Logged'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ds-card">
          <EmptyState icon={<BellRing size={26} strokeWidth={1.9} />} title="No alerts in the last 30 days" message="Email switches, failing sign-ins and server errors show here, and go to ALERT_EMAIL." />
        </div>
      )}
    </Section>
  );
}

function ServicesSection({ health, now }: Readonly<{ health: SystemHealth; now: number }>) {
  const { database, cron } = health;
  const pool = database.pool;
  const rows: { icon: ReactNode; title: string; detail: string; tone: 'ok' | 'attention' | 'down' | 'off' }[] = [
    {
      icon: <Database size={18} strokeWidth={2.1} />,
      title: 'Database',
      detail: database.status === 'down'
        ? 'Not reachable'
        : `${database.latencyMs ?? '?'} ms · ${database.schema === 'current' ? `up to date (${database.migration})` : database.schema === 'behind' ? `behind, needs ${database.migration}` : 'schema not checked'}`
          + (pool ? ` · ${pool.total - pool.idle} of ${pool.max} connections busy here${pool.waiting ? `, ${pool.waiting} waiting` : ''}` : ''),
      tone: database.status === 'down' || database.schema === 'behind' ? 'down' : 'ok',
    },
    {
      icon: <MoonStar size={18} strokeWidth={2.1} />,
      title: 'Nightly clean-up',
      detail: cron.state === 'off'
        ? 'Off: CRON_SECRET is not set'
        : cron.lastRunAt ? `Last ran ${when(cron.lastRunAt, now)} (${since(cron.lastRunAt, now)})` : 'Has not run on its own yet',
      tone: cron.state === 'ok' ? 'ok' : cron.state === 'off' ? 'off' : 'attention',
    },
    {
      icon: <KeyRound size={18} strokeWidth={2.1} />,
      title: 'Sign in with Google',
      detail: health.google.configured ? 'On' : 'Off: GOOGLE_CLIENT_ID is not set',
      tone: health.google.configured ? 'ok' : 'off',
    },
    {
      icon: <Activity size={18} strokeWidth={2.1} />,
      title: 'Rate limits',
      detail: health.rateLimitStore === 'postgres' ? 'Shared by every instance (PostgreSQL)' : health.rateLimitStore === 'memory' ? 'Per instance only (memory)' : 'Off',
      tone: health.rateLimitStore === 'postgres' ? 'ok' : 'attention',
    },
  ];
  const release = [health.release.commit ? health.release.commit.slice(0, 7) : null, health.release.region].filter(Boolean).join(' · ');
  return (
    <Section id="hl-services" title="Services" footer={release ? `Release ${release}` : undefined}>
      <ul className="ds-card hl-services">
        {rows.map((row) => (
          <li key={row.title} className={`is-${row.tone}`}>
            <span className="hl-service-icon" aria-hidden="true">{row.icon}</span>
            <div className="hl-service-body">
              <span className="hl-service-title">{row.title}</span>
              <span className="hl-service-detail">{row.detail}</span>
            </div>
            <span className="hl-service-state">{row.tone === 'ok' ? 'OK' : row.tone === 'off' ? 'Off' : row.tone === 'down' ? 'Down' : 'Check'}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading system health">
      <div className="hl-overall is-skeleton" aria-hidden="true">
        <span className="hl-overall-icon ds-skeleton" />
        <span className="hl-overall-body">
          <span className="ds-skeleton" style={{ width: '45%', height: 22 }} />
          <span className="ds-skeleton" style={{ width: '75%', height: 15, marginTop: 8 }} />
        </span>
      </div>
      <div className="hl-grid" aria-hidden="true">
        {[1, 2].map((item) => (
          <div className="hl-col" key={item}>
            <span className="ds-skeleton" style={{ height: 180, borderRadius: 16 }} />
            <span className="ds-skeleton" style={{ height: 140, borderRadius: 16 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
