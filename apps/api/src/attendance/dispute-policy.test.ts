import { describe, expect, it } from 'vitest';
import {
  acceptsCheckIns,
  disputeDeadline,
  earliestDisputableEnd,
  evaluateDisputeEligibility,
  sessionEndedAt,
  type DisputeFacts,
} from './dispute-policy.js';

const startsAt = new Date('2026-11-03T10:00:00.000Z');
const endsAt = new Date('2026-11-03T11:00:00.000Z');
const afterEnd = new Date('2026-11-03T12:00:00.000Z');

function facts(overrides: Partial<DisputeFacts> = {}): DisputeFacts {
  return {
    session: { status: 'open', startsAt, endsAt, closedAt: null },
    enrollment: { status: 'active', enrolledAt: new Date('2026-09-01T00:00:00.000Z') },
    recordStatus: null,
    priorDisputeStatuses: [],
    openDisputeCount: 0,
    ...overrides,
  };
}

describe('dispute policy', () => {
  it('uses the earlier of close time and scheduled end, and a 14-day window', () => {
    const early = { status: 'closed' as const, startsAt, endsAt, closedAt: new Date('2026-11-03T10:30:00.000Z') };
    expect(sessionEndedAt(early)).toEqual(early.closedAt);
    expect(disputeDeadline(early)).toEqual(new Date('2026-11-17T10:30:00.000Z'));
    expect(sessionEndedAt({ ...early, closedAt: new Date('2026-11-03T15:00:00.000Z') })).toEqual(endsAt);
    expect(earliestDisputableEnd(new Date('2026-11-17T10:30:00.000Z'))).toEqual(early.closedAt);
  });

  it('treats only running, unclosed sessions as accepting check-ins', () => {
    const open = facts().session;
    expect(acceptsCheckIns(open, new Date('2026-11-03T10:30:00.000Z'))).toBe(true);
    expect(acceptsCheckIns(open, endsAt)).toBe(false);
    expect(acceptsCheckIns(open, new Date('2026-11-03T09:59:00.000Z'))).toBe(false);
    expect(acceptsCheckIns({ ...open, status: 'closed', closedAt: startsAt }, new Date('2026-11-03T10:30:00.000Z'))).toBe(false);
  });

  it('allows a missing check-in after the session ends and a revoked one immediately', () => {
    expect(evaluateDisputeEligibility(facts(), afterEnd)).toEqual({
      kind: 'eligible',
      disputeKind: 'missing_check_in',
      deadline: new Date('2026-11-17T11:00:00.000Z'),
    });
    const during = new Date('2026-11-03T10:30:00.000Z');
    expect(evaluateDisputeEligibility(facts(), during)).toEqual({ kind: 'still_open' });
    expect(evaluateDisputeEligibility(facts({ recordStatus: 'revoked' }), during)).toMatchObject({
      kind: 'eligible',
      disputeKind: 'revoked_check_in',
    });
  });

  it.each<[string, Partial<DisputeFacts>, Date, string]>([
    ['no enrollment', { enrollment: null }, afterEnd, 'not_enrolled'],
    ['withdrawn enrollment', { enrollment: { status: 'withdrawn', enrolledAt: startsAt } }, afterEnd, 'not_enrolled'],
    ['enrolled after start', { enrollment: { status: 'active', enrolledAt: new Date('2026-11-03T10:01:00.000Z') } }, afterEnd, 'enrolled_after_session'],
    ['not started', {}, new Date('2026-11-03T09:00:00.000Z'), 'not_started'],
    ['already present', { recordStatus: 'present' }, afterEnd, 'already_present'],
    ['window closed', {}, new Date('2026-11-17T11:00:01.000Z'), 'window_closed'],
    ['already open', { priorDisputeStatuses: ['withdrawn', 'open'] }, afterEnd, 'already_open'],
    ['already upheld', { priorDisputeStatuses: ['upheld'] }, afterEnd, 'already_resolved'],
    ['already rejected', { priorDisputeStatuses: ['rejected'] }, afterEnd, 'already_resolved'],
    ['open-dispute cap', { openDisputeCount: 10 }, afterEnd, 'too_many_open'],
  ])('refuses when %s', (_label, overrides, now, kind) => {
    expect(evaluateDisputeEligibility(facts(overrides), now)).toEqual({ kind });
  });

  it('lets a withdrawn dispute be resubmitted and accepts the deadline instant itself', () => {
    expect(evaluateDisputeEligibility(facts({ priorDisputeStatuses: ['withdrawn'] }), afterEnd).kind).toBe('eligible');
    expect(evaluateDisputeEligibility(facts(), new Date('2026-11-17T11:00:00.000Z')).kind).toBe('eligible');
    expect(evaluateDisputeEligibility(facts({ openDisputeCount: 9 }), afterEnd).kind).toBe('eligible');
  });

  it('reports the most actionable reason first', () => {
    // Window closure outranks an earlier decision so the student is told the hard limit.
    expect(evaluateDisputeEligibility(
      facts({ priorDisputeStatuses: ['rejected'] }),
      new Date('2026-12-01T00:00:00.000Z'),
    )).toEqual({ kind: 'window_closed' });
    // Being present outranks everything about prior disputes.
    expect(evaluateDisputeEligibility(facts({ recordStatus: 'present', priorDisputeStatuses: ['open'] }), afterEnd))
      .toEqual({ kind: 'already_present' });
  });
});
