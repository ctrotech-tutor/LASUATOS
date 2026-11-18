import { describe, expect, it } from 'vitest';
import {
  currentStage, endedAt, isActive, isStatusIssue, isUpcoming, parseWatTime, publicText, readUpdate, readWindow, toIncident,
  type GitHubComment, type GitHubIssue,
} from './incidents.ts';

const NOW = Date.UTC(2026, 10, 10, 12, 0);

function issue(overrides: Partial<GitHubIssue> & { labelNames?: string[] } = {}): GitHubIssue {
  const { labelNames, ...rest } = overrides;
  return {
    number: 7,
    title: 'Check-in is failing',
    body: 'We are looking into reports that check-in fails.',
    state: 'open',
    labels: (labelNames ?? ['status', 'major', 'component: attendance']).map((name) => ({ name })),
    created_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:30:00Z',
    closed_at: null,
    author_association: 'OWNER',
    user: { login: 'owner' },
    ...rest,
  };
}

function comment(body: string, at: string, association = 'MEMBER'): GitHubComment {
  return { id: Math.random(), body, created_at: at, author_association: association, user: { login: 'x' } };
}

describe('which issues show', () => {
  it('needs the status label and a maintainer as author, and never a pull request', () => {
    expect(isStatusIssue(issue())).toBe(true);
    expect(isStatusIssue(issue({ labelNames: ['bug'] }))).toBe(false);
    expect(isStatusIssue(issue({ author_association: 'NONE' }))).toBe(false);
    expect(isStatusIssue(issue({ author_association: 'CONTRIBUTOR' }))).toBe(false);
    expect(isStatusIssue({ ...issue(), pull_request: {} })).toBe(false);
  });
});

describe('toIncident', () => {
  it('reads labels, stages and the order of updates', () => {
    const incident = toIncident(issue(), [
      comment('Identified: the database ran out of connections.', '2026-11-10T10:10:00Z'),
      comment('**Monitoring** - a fix is out, watching it.', '2026-11-10T10:20:00Z'),
    ], NOW);
    expect(incident).toMatchObject({ id: 'gh-7', kind: 'incident', impact: 'major', components: ['attendance'], automatic: false, resolvedAt: null });
    expect(incident.updates.map((update) => update.stage)).toEqual(['monitoring', 'identified', 'investigating']);
    expect(incident.updates[0]!.body).toBe('a fix is out, watching it.');
    expect(currentStage(incident, NOW)).toBe('monitoring');
    expect(isActive(incident, NOW)).toBe(true);
  });

  it('ignores comments from people who are not maintainers, and private notes', () => {
    const incident = toIncident(issue({ body: 'Public text.\n<!-- the Neon password was rotated -->' }), [
      comment('Resolved: lol it works for me', '2026-11-10T10:10:00Z', 'NONE'),
      comment('<!-- internal only -->', '2026-11-10T10:11:00Z'),
    ], NOW);
    expect(incident.updates).toHaveLength(1);
    expect(incident.updates[0]!.body).toBe('Public text.');
    expect(incident.resolvedAt).toBeNull();
  });

  it('ends it on a Resolved update even before the issue is closed', () => {
    const incident = toIncident(issue(), [comment('Resolved: all good now.', '2026-11-10T11:00:00Z')], NOW);
    expect(incident.resolvedAt).toBe(Date.parse('2026-11-10T11:00:00Z'));
    expect(currentStage(incident, NOW)).toBe('resolved');
  });

  it('adds a resolved line when the issue is closed without one', () => {
    const incident = toIncident(issue({ state: 'closed', closed_at: '2026-11-10T11:30:00Z' }), [], NOW);
    expect(incident.updates[0]).toMatchObject({ stage: 'resolved', at: Date.parse('2026-11-10T11:30:00Z') });
    expect(endedAt(incident, NOW)).toBe(Date.parse('2026-11-10T11:30:00Z'));
  });

  it('reads a maintenance window in WAT and moves through its stages', () => {
    const maintenance = issue({
      title: 'Database upgrade',
      labelNames: ['status', 'maintenance'],
      body: 'Starts: 2026-11-20 22:00\nEnds: 2026-11-20 23:30 WAT\n\nLASUATOS may be unavailable for a few minutes.',
    });
    const before = Date.UTC(2026, 10, 20, 12, 0);
    const incident = toIncident(maintenance, [], before);
    expect(incident.startsAt).toBe(Date.UTC(2026, 10, 20, 21, 0));
    expect(incident.endsAt).toBe(Date.UTC(2026, 10, 20, 22, 30));
    expect(incident.updates[0]!.body).toBe('LASUATOS may be unavailable for a few minutes.');
    expect(isUpcoming(incident, before)).toBe(true);
    expect(currentStage(incident, before)).toBe('scheduled');
    const during = Date.UTC(2026, 10, 20, 21, 30);
    expect(isActive(incident, during)).toBe(true);
    expect(currentStage(incident, during)).toBe('in_progress');
    // Past its end with nobody closing it: completed, ended at the planned end.
    const after = Date.UTC(2026, 10, 21, 8, 0);
    expect(isActive(incident, after)).toBe(false);
    expect(currentStage(incident, after)).toBe('completed');
    expect(endedAt(incident, after)).toBe(incident.endsAt);
  });
});

describe('text helpers', () => {
  it('reads stage words only at the start', () => {
    expect(readUpdate('Investigating: reports of slow check-in')).toEqual({ stage: 'investigating', body: 'reports of slow check-in' });
    expect(readUpdate('Fixed.')).toEqual({ stage: 'resolved', body: '' });
    expect(readUpdate('Fixed the typo in the notice')).toEqual({ stage: null, body: 'Fixed the typo in the notice' });
    expect(readUpdate('We have identified the cause')).toEqual({ stage: null, body: 'We have identified the cause' });
  });

  it('drops unfinished comment marks too', () => {
    expect(publicText('Hello <!-- secret')).toBe('Hello');
    expect(publicText(null)).toBe('');
  });

  it('parses WAT and ISO times, and leaves other lines alone', () => {
    expect(parseWatTime('2026-11-20 22:00')).toBe(Date.UTC(2026, 10, 20, 21, 0));
    expect(parseWatTime('2026-11-20T22:00+01:00')).toBe(Date.UTC(2026, 10, 20, 21, 0));
    expect(parseWatTime('2026-11-20T21:00Z')).toBe(Date.UTC(2026, 10, 20, 21, 0));
    expect(parseWatTime('next Friday')).toBeNull();
    expect(readWindow('Starts: whenever\nBody').rest).toBe('Starts: whenever\nBody');
  });
});
