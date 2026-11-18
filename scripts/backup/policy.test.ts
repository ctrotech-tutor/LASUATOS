import { describe, expect, it } from 'vitest';
import {
  KEEP, STAGE_HINT, ageRecipientCount, backupTag, compareInventories, directConnectionString, formatBytes,
  githubAnnotation, parseBackupTag, parseRecipients, redact, selectBackups,
} from './policy.mjs';
import { countSql, sequenceSql } from './inventory.mjs';
import { identitiesIn } from './open.mjs';

const at = (iso: string) => new Date(iso);
const RECIPIENT = 'age1tzcrxf8t36qmxqnd0mjj34numrwce6t2xtymank6cu9vn27s8drqnthemn';

describe('backup tags', () => {
  it('are UTC and round-trip', () => {
    const date = at('2026-11-10T03:17:02.900Z');
    expect(backupTag(date)).toBe('db-20261110-031702');
    expect(parseBackupTag('db-20261110-031702')?.toISOString()).toBe('2026-11-10T03:17:02.000Z');
  });

  it('ignore anything that is not a real backup time', () => {
    for (const tag of ['v1.0.0', 'db-20261332-000000', 'db-20261110-246000', 'db-2026111-031702', 'xdb-20261110-031702']) {
      expect(parseBackupTag(tag)).toBeNull();
    }
  });
});

describe('which backups are kept', () => {
  const now = at('2026-11-10T04:00:00Z');
  /** One backup a night at 03:17 for `days` nights, newest first. */
  const nightly = (days: number) => Array.from({ length: days }, (_, index) => backupTag(new Date(Date.UTC(2026, 10, 10 - index, 3, 17))));

  it('keeps every night for 14 days, then one a week to 8 weeks, and nothing older', () => {
    const tags = nightly(120);
    const { keep, remove, oldestKept } = selectBackups(tags, now);
    // 14 nights, plus the newest of each older week inside 8 weeks.
    expect(keep.slice(0, 14)).toEqual(tags.slice(0, 14));
    const weeksOld = (tag: string) => (now.getTime() - parseBackupTag(tag)!.getTime()) / (7 * 24 * 3600_000);
    expect(Math.max(...keep.map(weeksOld))).toBeLessThan(KEEP.weeklyWeeks);
    expect(keep.length).toBeGreaterThanOrEqual(14 + 5);
    expect(keep.length).toBeLessThanOrEqual(14 + 8);
    expect(new Set([...keep, ...remove]).size).toBe(tags.length);
    // Kept weekly backups are Sundays: the newest of each Monday-to-Sunday week.
    for (const tag of keep.slice(14)) expect(parseBackupTag(tag)!.getUTCDay()).toBe(0);
    expect(oldestKept!.getTime()).toBe(Math.min(...keep.map((tag) => parseBackupTag(tag)!.getTime())));
  });

  it('keeps the newest of a day when the job ran twice', () => {
    const tags = ['db-20261110-031700', 'db-20261109-031700', 'db-20261108-031700', 'db-20261105-150000', 'db-20261105-031700'];
    const { keep, remove } = selectBackups(tags, at('2026-11-10T13:00:00Z'));
    expect(keep).toContain('db-20261105-150000');
    expect(remove).toEqual(['db-20261105-031700']);
  });

  it('keeps the newest 3 through a gap in runs, but nothing past 8 weeks (the privacy promise)', () => {
    // Backups failed for three weeks: the last three good ones stay although the daily rule
    // would keep only one of them (they share a week).
    const gap = ['db-20261020-031700', 'db-20261019-031700', 'db-20261018-031700', 'db-20261010-031700'];
    expect(selectBackups(gap, now).keep).toEqual(['db-20261020-031700', 'db-20261019-031700', 'db-20261018-031700', 'db-20261010-031700']);
    // Older than 8 weeks: removed even if they are the only copies.
    const { keep, remove } = selectBackups(['db-20250101-031700', 'db-20250102-031700', 'db-20250103-031700'], now);
    expect(keep).toEqual([]);
    expect(remove).toHaveLength(3);
  });

  it('never deletes foreign tags or backups dated in the future', () => {
    const { keep, remove } = selectBackups(['v2.0.0', 'db-20270101-000000', ...nightly(3)], now);
    expect(keep).toContain('db-20270101-000000');
    expect(remove).not.toContain('v2.0.0');
    expect(keep).not.toContain('v2.0.0');
  });
});

describe('the database address', () => {
  it('switches the Neon pooled address to the direct one', () => {
    const result = directConnectionString('postgresql://u:p@ep-cool-river-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require');
    expect(result.changed).toBe(true);
    expect(result.url).toBe('postgresql://u:p@ep-cool-river-123.eu-central-1.aws.neon.tech/neondb?sslmode=require');
    expect(directConnectionString('postgres://u:p@localhost:5432/db').changed).toBe(false);
  });

  it('refuses something that is not a PostgreSQL address', () => {
    expect(() => directConnectionString('mysql://u:p@h/d')).toThrow(/postgresql/);
    expect(() => directConnectionString('not a url')).toThrow(/valid/);
  });
});

describe('encryption keys', () => {
  it('reads one or more public keys, with comments and any separator', () => {
    expect(parseRecipients(`# Sewanu\n${RECIPIENT}\n`)).toEqual([RECIPIENT]);
    const second = 'age1q6mwqwv7fpaaptqd240ev2w7klm63l6hajgssfcyh0kehwnlmfuqxsgqyj';
    expect(parseRecipients(`${RECIPIENT}, ${second} ${RECIPIENT}`)).toEqual([RECIPIENT, second]);
  });

  it('refuses a private key pasted by mistake, and says so', () => {
    expect(() => parseRecipients('AGE-SECRET-KEY-1QQQQQQ')).toThrow(/PRIVATE/);
    expect(() => parseRecipients('')).toThrow(/empty/);
    expect(() => parseRecipients('ssh-ed25519 AAAA')).toThrow(/not an age public key/);
  });

  it('counts the recipients named in an age header', () => {
    const header = `age-encryption.org/v1\n-> X25519 abc\nbody\n-> X25519 def\nbody\n--- mac\n\u0000binary-> X25519`;
    expect(ageRecipientCount(Buffer.from(header))).toBe(2);
    expect(ageRecipientCount(Buffer.from('PGDMP'))).toBe(0);
  });

  it('finds the private keys in a key file', () => {
    expect(identitiesIn('# created\n# public key: age1x\r\nAGE-SECRET-KEY-1ABC\n\n')).toEqual(['AGE-SECRET-KEY-1ABC']);
  });
});

describe('comparing the database with the restored copy', () => {
  const live = {
    tables: [{ name: 'public.users', rows: 120 }, { name: 'drizzle.__drizzle_migrations', rows: 32 }],
    sequences: [{ name: 'drizzle.__drizzle_migrations_id_seq', value: '32' }],
    objects: { indexes: 172, constraints: 224, triggers: 6 },
    extensions: [],
  };

  it('finds nothing when they match', () => {
    expect(compareInventories(live, structuredClone(live))).toEqual([]);
  });

  it('names every difference', () => {
    const restored = {
      tables: [{ name: 'public.users', rows: 119 }, { name: 'public.extra', rows: 0 }],
      sequences: [{ name: 'drizzle.__drizzle_migrations_id_seq', value: '1' }],
      objects: { indexes: 171, constraints: 224 },
      extensions: [],
    };
    expect(compareInventories(live, restored)).toEqual([
      'table public.users has 119 rows restored, 120 in the database',
      'table drizzle.__drizzle_migrations is missing from the restored copy',
      'table public.extra appeared in the restored copy only',
      'sequence drizzle.__drizzle_migrations_id_seq is at 1 restored, 32 in the database',
      '171 indexes restored, 172 in the database',
      '0 triggers restored, 6 in the database',
    ]);
  });
});

describe('the counting statements', () => {
  it('quote every name, so odd table names cannot break or inject', () => {
    const sql = countSql([{ schema: 'public', name: 'users' }, { schema: 'we"ird', name: "o'brien" }])!;
    expect(sql).toContain(`select 'public.users' as name, count(*)::text as rows from "public"."users"`);
    expect(sql).toContain(`from "we""ird"."o'brien"`);
    expect(sql).toContain(`'"we""ird"."o''brien"' as name`);
    expect(countSql([])).toBeNull();
    expect(sequenceSql([{ schema: 'drizzle', name: 'seq' }])).toContain('case when is_called then last_value::text end');
  });
});

describe('error text in reports', () => {
  it('never carries a password, connection string or token', () => {
    const message = redact(`connect failed for postgresql://lasuatos_backup:Sup3rS3cret@ep-x.neon.tech/neondb?sslmode=require
      password=hunter2 token ghp_${'a'.repeat(36)} github_pat_${'b'.repeat(40)} AGE-SECRET-KEY-1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L`);
    expect(message).not.toMatch(/Sup3rS3cret|hunter2|ghp_a|github_pat_b|AGE-SECRET-KEY-1Q/);
    expect(message).toContain('postgresql://…');
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message).not.toContain('\n');
  });

  it('gives readable sizes', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(3_628_741)).toBe('3.6 MB');
    expect(formatBytes(512_000_000)).toBe('512 MB');
  });
});

describe('githubAnnotation', () => {
  it('builds a workflow command the runner shows under ANNOTATIONS', () => {
    expect(githubAnnotation('error', 'Backup failed at config', 'BACKUP_REPOSITORY is not set'))
      .toBe('::error title=Backup failed at config::BACKUP_REPOSITORY is not set');
  });

  it('escapes what would end the command early, and redacts secrets', () => {
    const line = githubAnnotation('error', 'a: b, c', 'x 100% postgresql://u:p@h/db ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(line).toBe('::error title=a%3A b%2C c::x 100%25 postgresql://… …');
    expect(line).not.toContain('\n');
  });

  it('has a first thing to check for every stage that can fail', () => {
    expect(Object.keys(STAGE_HINT).sort()).toEqual(['config', 'connect', 'dump', 'encrypt', 'prune', 'restore', 'upload', 'verify']);
  });
});
