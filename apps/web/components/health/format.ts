import { EMAIL_PROVIDER_LABELS, type BackupStage, type EmailFailureKind, type HealthBackupRun, type HealthEmailProvider, type HealthSignal, type OperatorAlertKind, type SystemHealth } from '@lasuatos/contracts';

/** Wording and small calculations for System health (/admin/health). */

export const PATH = '/admin/health';
export const HEALTH_KEY = 'admin:health';

export type Tone = 'ok' | 'attention' | 'down';

export const OVERALL_TITLE: Readonly<Record<SystemHealth['overall'], string>> = {
  ok: 'Everything is working',
  attention: 'Something needs a look',
  down: 'Students are affected now',
};

export const FAILURE_LABEL: Readonly<Record<EmailFailureKind, string>> = {
  quota: 'daily limit reached',
  setup: 'setup problem',
  network: 'could not reach it',
  recipient: 'address refused',
  unknown: 'refused',
};

export const SIGNAL_LABEL: Readonly<Record<HealthSignal['signal'], { title: string; unit: string }>> = {
  sign_in_failures: { title: 'Wrong passwords and codes', unit: 'failed sign-ins and check-ins' },
  rate_limited: { title: 'Refused as too fast', unit: 'requests refused' },
  server_errors: { title: 'Server errors', unit: 'errors' },
  google_refused: { title: 'Google sign-ins refused', unit: 'refused' },
  google_broken: { title: 'Google setup failures', unit: 'failures' },
  face_unavailable: { title: 'Face engine failed to start', unit: 'failures' },
};

export const ALERT_LABEL: Readonly<Record<OperatorAlertKind, string>> = {
  server_error: 'Server error',
  page_error: 'Page error',
  schema_behind: 'Database behind',
  email_failover: 'Email switched',
  email_failing: 'Email failing',
  email_quota: 'Email allowance',
  error_rate: 'Error rate up',
  rate_limited: 'Rate limits',
  sign_in_failures: 'Sign-in failures',
  google_failing: 'Google sign-in',
  backup_failed: 'Backup failed',
  backup_late: 'Backups stopped',
};

/** Alerts that mean students could not get through, shown in red. */
const URGENT_ALERTS = new Set<OperatorAlertKind>(['email_failing', 'schema_behind', 'server_error', 'error_rate', 'google_failing']);
export const alertTone = (kind: OperatorAlertKind): Tone => (URGENT_ALERTS.has(kind) ? 'down' : kind === 'email_quota' ? 'ok' : 'attention');

/** The step a backup run stopped at, as "failed while …". */
export const BACKUP_STEP: Readonly<Record<BackupStage, string>> = {
  config: 'checking its settings',
  connect: 'connecting to the database',
  dump: 'copying the database',
  restore: 'test-restoring the copy',
  verify: 'checking the restored copy',
  encrypt: 'encrypting the copy',
  upload: 'storing the copy',
  prune: 'removing old copies',
  done: 'finishing',
};

/** "3.4 MB": backup sizes, in the units people expect. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1_000;
  let unit = 0;
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

/** "47 tables, 1,234 rows" for a verified copy; null when the run did not say. */
export function backupContents(run: HealthBackupRun): string | null {
  if (run.tables === null || run.rows === null) return null;
  return `${plural(run.tables, 'table')}, ${plural(run.rows, 'row')}`;
}

const lagosShortDay = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });

/** "12 copies, oldest 25 Sep". */
export function backupKept(run: HealthBackupRun): string | null {
  if (run.kept === null) return null;
  return `${plural(run.kept, 'copy', 'copies')}${run.oldestKeptAt ? `, oldest ${lagosShortDay.format(new Date(run.oldestKeptAt))}` : ''}`;
}

export const providerName = (provider: HealthEmailProvider['provider']) => EMAIL_PROVIDER_LABELS[provider];

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

const lagosTime = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });
const lagosDay = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const utcDay = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const lagosDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Lagos' });

/** "3:05 pm" today, "yesterday 3:05 pm", or "Mon 9 Nov, 3:05 pm" (Lagos time). */
export function when(iso: string, now: number): string {
  const at = new Date(iso);
  const time = lagosTime.format(at).replace(/\s/g, ' ').toLowerCase();
  const day = lagosDate.format(at);
  if (day === lagosDate.format(new Date(now))) return time;
  if (day === lagosDate.format(new Date(now - 86_400_000))) return `yesterday ${time}`;
  return `${lagosDay.format(at)}, ${time}`;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function since(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** A UTC day ("2026-11-10") as "Tue 10 Nov": provider allowances reset at midnight UTC. */
export const dayLabel = (day: string) => utcDay.format(new Date(`${day}T12:00:00Z`));

/** "128 of 300 today", or "128 today" without a limit. */
export function usageLine(provider: HealthEmailProvider): string {
  return provider.limit === null ? `${provider.sentToday.toLocaleString('en-NG')} today` : `${provider.sentToday.toLocaleString('en-NG')} of ${provider.limit.toLocaleString('en-NG')} today`;
}

/** Share of the daily allowance used, 0 to 1; null without a limit. */
export const usageShare = (provider: HealthEmailProvider) => (provider.limit ? Math.min(1, provider.sentToday / provider.limit) : null);

/** Why a provider is skipped right now, for its card. */
export function stateLine(provider: HealthEmailProvider, now: number): string | null {
  if (provider.state === 'full') return 'Used all of today’s allowance. Back at 1:00 am (midnight UTC).';
  if (provider.state === 'paused' && provider.pausedUntil) {
    const why = provider.lastFailureKind ? FAILURE_LABEL[provider.lastFailureKind] : 'refused';
    return `Skipped until ${when(provider.pausedUntil, now)} (${why}). Still tried if every other provider fails.`;
  }
  return null;
}

/** Bar heights (0 to 1) for the last days, against the limit or the busiest day. */
export function bars(history: readonly number[], limit: number | null): number[] {
  const top = Math.max(limit ?? 0, ...history, 1);
  return history.map((count) => count / top);
}

export type Problem = { readonly tone: 'attention' | 'down'; readonly text: string };

/** Each thing behind a status other than ok, most urgent first, in plain words. */
export function problems(health: SystemHealth, now: number): Problem[] {
  const found: Problem[] = [];
  const { database, email, cron } = health;
  if (database.status === 'down') found.push({ tone: 'down', text: 'The database cannot be reached. Nobody can sign in or check in.' });
  else if (database.schema === 'behind') found.push({ tone: 'down', text: `The database is behind this release (needs ${database.migration}). Run the migrations.` });
  if (!email.configured) found.push({ tone: 'down', text: 'No email provider is set up, so sign-up codes and password resets are not sent.' });
  else if (email.current === null) found.push({ tone: 'down', text: 'Every email provider is skipped. Emails are still tried, but are probably not arriving.' });
  const recentFailing = health.alerts.find((alert) => alert.kind === 'email_failing' && now - Date.parse(alert.occurredAt) < 30 * 60_000);
  if (recentFailing && email.current !== null) found.push({ tone: 'down', text: `Emails failed on every provider ${since(recentFailing.occurredAt, now)}.` });
  for (const provider of email.providers) {
    if (provider.state === 'ready') continue;
    const fallback = email.current ? ` Emails go through ${providerName(email.current)} meanwhile.` : '';
    found.push({
      tone: 'attention',
      text: provider.state === 'full'
        ? `${providerName(provider.provider)} has used ${provider.limit ? `all ${provider.limit} of today’s emails` : 'today’s emails'}.${fallback}`
        : `${providerName(provider.provider)} is skipped (${provider.lastFailureKind ? FAILURE_LABEL[provider.lastFailureKind] : 'refused'}).${fallback}`,
    });
  }
  if (cron.state === 'late') found.push({ tone: 'attention', text: `The nightly clean-up last ran ${cron.lastRunAt ? since(cron.lastRunAt, now) : 'a while ago'}. Check Cron Jobs in Vercel.` });
  if (cron.state === 'never') found.push({ tone: 'attention', text: 'The nightly clean-up has not run on its own yet.' });
  const { backups } = health;
  const lastGood = backups.lastGood ? ` The last good copy is from ${when(backups.lastGood.finishedAt, now)}.` : '';
  if (backups.state === 'failed' && backups.last) {
    found.push({ tone: 'attention', text: `The last backup failed while ${BACKUP_STEP[backups.last.stage]}.${lastGood || ' There is no good copy yet.'}` });
  } else if (backups.state === 'late') {
    found.push({ tone: 'attention', text: `No good backup ${backups.lastGood ? `for ${since(backups.lastGood.finishedAt, now).replace(' ago', '')}` : 'yet'}. Check the backup workflow in GitHub.` });
  } else if (backups.state === 'never') {
    found.push({ tone: 'attention', text: 'No backup has been reported yet. Run the backup workflow once in GitHub to check it works.' });
  }
  for (const signal of health.signals) {
    if (signal.count < signal.threshold) continue;
    found.push({ tone: 'attention', text: `${SIGNAL_LABEL[signal.signal].title}: ${signal.count} in ${signal.windowMinutes} minutes (alert at ${signal.threshold}).` });
  }
  if (health.overall !== 'ok' && !found.length) {
    const latest = health.alerts.find((alert) => alert.kind !== 'email_quota');
    if (latest) found.push({ tone: 'attention', text: `${ALERT_LABEL[latest.kind]} ${since(latest.occurredAt, now)}: ${latest.summary}.` });
  }
  return found;
}

/** The one-line answer under the headline. */
export function overallLine(health: SystemHealth, now: number): string {
  if (health.overall === 'ok') {
    const via = health.email.current ? `Emails go through ${providerName(health.email.current)}` : 'Email is not set up';
    return `${via}, the database answers in ${health.database.latencyMs ?? '?'} ms, and nothing unusual in the last hours.`;
  }
  const count = problems(health, now).length;
  return count > 1 ? `${count} things below.` : 'Details below.';
}

export const signalShare = (signal: HealthSignal) => Math.min(1, signal.count / signal.threshold);
