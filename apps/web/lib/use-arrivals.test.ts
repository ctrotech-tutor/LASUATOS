import { describe, expect, it } from 'vitest';
import { arrivalsSentence } from './use-arrivals';

describe('arrivalsSentence', () => {
  it('names one or two people and counts more', () => {
    expect(arrivalsSentence([], 'checked in')).toBe('');
    expect(arrivalsSentence(['Ada Bello'], 'checked in')).toBe('Ada Bello checked in');
    expect(arrivalsSentence(['Ada Bello', 'Chidi Obi'], 'checked in')).toBe('Ada Bello and Chidi Obi checked in');
    expect(arrivalsSentence(['A', 'B', 'C'], 'sent new disputes')).toBe('3 students sent new disputes');
  });
});
