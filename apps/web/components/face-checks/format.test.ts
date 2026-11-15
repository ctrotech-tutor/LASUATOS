import { describe, expect, it } from 'vitest';
import { FACE_MATCH, type FaceReviewItem } from '@lasuatos/contracts';
import { closeness, dayLabel, groupBySession, isWeak } from './format';

const item = (id: string, sessionId: string): FaceReviewItem => ({ id, sessionId } as FaceReviewItem);

describe('face check wording', () => {
  it('places a score between the pass line and a clear match', () => {
    expect(closeness(FACE_MATCH.pass)).toBe(0);
    expect(closeness(FACE_MATCH.clear)).toBe(1);
    expect(closeness((FACE_MATCH.pass + FACE_MATCH.clear) / 2)).toBeCloseTo(0.5);
    expect(closeness(0.1)).toBe(0);
    expect(closeness(0.99)).toBe(1);
  });

  it('calls the lower third weak', () => {
    expect(isWeak(FACE_MATCH.pass + 0.01)).toBe(true);
    expect(isWeak(FACE_MATCH.pass + (FACE_MATCH.clear - FACE_MATCH.pass) * 0.4)).toBe(false);
  });

  it('keeps one group per session, even when sessions overlap', () => {
    const groups = groupBySession([item('1', 'a'), item('2', 'b'), item('3', 'a'), item('4', 'c'), item('5', 'b')]);
    expect(groups.map((group) => [group.sessionId, group.items.map((entry) => entry.id)])).toEqual([
      ['a', ['1', '3']],
      ['b', ['2', '5']],
      ['c', ['4']],
    ]);
  });

  it('names days in Lagos time', () => {
    const now = Date.parse('2026-11-10T09:00:00Z');
    expect(dayLabel('2026-11-10T07:00:00Z', now)).toBe('Today');
    // 23:30 UTC on the 9th is already the 10th in Lagos.
    expect(dayLabel('2026-11-09T23:30:00Z', now)).toBe('Today');
    expect(dayLabel('2026-11-09T07:00:00Z', now)).toBe('Yesterday');
    expect(dayLabel('2026-11-04T07:00:00Z', now)).toMatch(/4 Nov/);
  });
});
