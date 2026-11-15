import { describe, expect, it } from 'vitest';
import { sessionsToReach } from './format';

describe('sessions in a row to reach the required attendance', () => {
  it('is null when the student is already there', () => {
    expect(sessionsToReach(3, 4, 75)).toBeNull();
    expect(sessionsToReach(0, 0, 75)).toBeNull();
  });

  it('is the fewest sessions in a row that get there', () => {
    // 2 of 4 (50%): 3 more makes 5 of 7 (71%), 4 more makes 6 of 8 (75%).
    expect(sessionsToReach(2, 4, 75)).toBe(4);
    // 7 of 10 (70%): one more makes 8 of 11 (72.7%), two more 9 of 12 (75%).
    expect(sessionsToReach(7, 10, 75)).toBe(2);
    expect(sessionsToReach(0, 1, 50)).toBe(1);
  });

  it('cannot reach 100% once a session is missed', () => {
    expect(sessionsToReach(3, 4, 100)).toBe(Infinity);
  });
});
