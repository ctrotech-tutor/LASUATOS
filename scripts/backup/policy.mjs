// Pure rules for database backups (ADR 035). No I/O here, so every rule is unit tested
// (policy.test.ts) and the nightly job (run.mjs) only wires them to real tools.

const DAY = 24 * 60 * 60 * 1_000;

/**
 * What is kept. Every backup from the last 14 days (the newest of each day), then one a week
 * (the newest of each week) back to 8 weeks, and always the newest 3 whatever their age.
 *
 * The 8 weeks are also a privacy promise. A face or a person deleted from LASUATOS (by the
 * nightly clean-up or by hand) is gone from every backup within 8 weeks, so backups never
 * keep personal data much longer than the app itself does.
 */
export const KEEP = Object.freeze({ newest: 3, dailyDays: 14, weeklyWeeks: 8 });

const TAG_PATTERN = /^db-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

const pad = (value) => String(value).padStart(2, '0');

/** The release tag of a backup taken at `date`, in UTC: db-20261110-031702. */
export function backupTag(date) {
  return `db-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

/** The time in a backup tag, or null for anything that is not a backup tag. */
export function parseBackupTag(tag) {
  const match = TAG_PATTERN.exec(String(tag));
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Rejects 20261332 and the like, which Date.UTC would quietly roll over.
  return backupTag(date) === tag ? date : null;
}

const dayKey = (date) => date.toISOString().slice(0, 10);

/** Monday of the date's week (UTC), so a week is Monday to Sunday. */
function weekKey(date) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dayKey(monday);
}

/**
 * Splits existing backup tags into those to keep and those to delete. Tags that are not
 * backup tags are never touched, and neither is anything dated in the future (a wrong
 * clock must not delete good backups).
 */
export function selectBackups(tags, now, keep = KEEP) {
  const dated = [];
  const kept = new Set();
  for (const tag of tags) {
    const date = parseBackupTag(tag);
    if (!date) continue;
    if (date.getTime() > now.getTime()) kept.add(tag);
    else dated.push({ tag, date });
  }
  dated.sort((a, b) => b.date.getTime() - a.date.getTime());

  // The newest few are kept even when the daily rule would drop them (several runs in one day,
  // or a gap in runs), but never past the weekly horizon: nothing older than 8 weeks is kept,
  // which is what the privacy notice promises about deleted data.
  for (const { tag, date } of dated.slice(0, keep.newest)) {
    if (now.getTime() - date.getTime() < keep.weeklyWeeks * 7 * DAY) kept.add(tag);
  }
  const days = new Set();
  const weeks = new Set();
  for (const { tag, date } of dated) {
    const age = now.getTime() - date.getTime();
    const day = dayKey(date);
    if (age < keep.dailyDays * DAY && !days.has(day)) {
      days.add(day);
      kept.add(tag);
    }
    const week = weekKey(date);
    if (age < keep.weeklyWeeks * 7 * DAY && !weeks.has(week)) {
      weeks.add(week);
      kept.add(tag);
    }
  }

  const remove = dated.filter(({ tag }) => !kept.has(tag)).map(({ tag }) => tag);
  const keptDates = dated.filter(({ tag }) => kept.has(tag)).map(({ date }) => date);
  return {
    keep: [...kept].sort().reverse(),
    remove,
    oldestKept: keptDates.length ? keptDates[keptDates.length - 1] : null,
  };
}

/**
 * Neon's pooled address (…-pooler.…) runs PgBouncer in transaction mode, which pg_dump
 * cannot use and which cannot hold the exported snapshot. Backups always use the direct
 * address, whichever one was pasted.
 */
export function directConnectionString(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BACKUP_DATABASE_URL is not a valid connection string.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('BACKUP_DATABASE_URL must start with postgresql://.');
  }
  const host = url.hostname.replace(/-pooler(?=\.)/, '');
  const changed = host !== url.hostname;
  url.hostname = host;
  return { url: url.toString(), changed };
}

/** The age public keys backups are encrypted to: one or more, separated by spaces, commas or lines. */
export function parseRecipients(text) {
  const recipients = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, ''))
    .join(' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('BACKUP_AGE_RECIPIENTS is empty. Add the public key printed by pnpm backup:keygen (it starts with age1).');
  }
  for (const recipient of recipients) {
    if (recipient.startsWith('AGE-SECRET-KEY-')) {
      throw new Error('BACKUP_AGE_RECIPIENTS holds a PRIVATE key. Remove it from GitHub now, and use the public key (age1…) instead.');
    }
    if (!/^age1[02-9ac-hj-np-z]{58,}$/.test(recipient)) {
      throw new Error(`"${recipient.slice(0, 12)}…" in BACKUP_AGE_RECIPIENTS is not an age public key (they start with age1).`);
    }
  }
  return [...new Set(recipients)];
}

/** How many recipients an age file is encrypted to, read from its text header. */
export function ageRecipientCount(header) {
  const text = Buffer.from(header).toString('latin1');
  if (!text.startsWith('age-encryption.org/v1\n')) return 0;
  const end = text.indexOf('\n---');
  const stanzas = (end === -1 ? text : text.slice(0, end)).split('\n').filter((line) => line.startsWith('-> '));
  return stanzas.length;
}

/**
 * Differences between the live database (inside the backup's snapshot) and the restored
 * copy. Empty means the backup holds exactly what the database held: the same tables with
 * the same number of rows, the same sequences at the same values, and the same indexes,
 * constraints, triggers, functions, views and types.
 */
export function compareInventories(live, restored) {
  const problems = [];
  const liveTables = new Map(live.tables.map((table) => [table.name, table.rows]));
  const restoredTables = new Map(restored.tables.map((table) => [table.name, table.rows]));
  for (const [name, rows] of liveTables) {
    if (!restoredTables.has(name)) problems.push(`table ${name} is missing from the restored copy`);
    else if (restoredTables.get(name) !== rows) problems.push(`table ${name} has ${restoredTables.get(name)} rows restored, ${rows} in the database`);
  }
  for (const name of restoredTables.keys()) {
    if (!liveTables.has(name)) problems.push(`table ${name} appeared in the restored copy only`);
  }

  const liveSequences = new Map(live.sequences.map((sequence) => [sequence.name, sequence.value]));
  for (const sequence of restored.sequences) {
    if (!liveSequences.has(sequence.name)) problems.push(`sequence ${sequence.name} appeared in the restored copy only`);
    else if (liveSequences.get(sequence.name) !== sequence.value) {
      problems.push(`sequence ${sequence.name} is at ${sequence.value} restored, ${liveSequences.get(sequence.name)} in the database`);
    }
    liveSequences.delete(sequence.name);
  }
  for (const name of liveSequences.keys()) problems.push(`sequence ${name} is missing from the restored copy`);

  for (const [kind, count] of Object.entries(live.objects)) {
    if (restored.objects[kind] !== count) problems.push(`${restored.objects[kind] ?? 0} ${kind} restored, ${count} in the database`);
  }
  return problems;
}

/** Totals for the report: how many tables and rows a backup holds. */
export function inventoryTotals(inventory) {
  return {
    tables: inventory.tables.length,
    rows: inventory.tables.reduce((sum, table) => sum + table.rows, 0),
  };
}

/**
 * Error text that is safe to put in a report, a log or an email: connection strings,
 * passwords and tokens removed, one line, at most 300 characters.
 */
export function redact(message) {
  return String(message ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://…')
    .replace(/(password|passwd|pwd)\s*[=:]\s*[^\s'"&]+/gi, '$1=…')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '…')
    .replace(/AGE-SECRET-KEY-1[0-9A-Z]+/g, '…')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Human size: 4.2 MB. */
export function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1_000;
  let unit = 0;
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
