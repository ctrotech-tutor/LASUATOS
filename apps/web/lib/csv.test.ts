import { describe, expect, it } from 'vitest';
import { csvCell, csvText } from './csv';

describe('CSV cells for spreadsheets', () => {
  it('quotes every cell and doubles quotes', () => {
    expect(csvCell('Ada "Ace" Obi, Jr.')).toBe('"Ada ""Ace"" Obi, Jr."');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });

  it('defuses anything a spreadsheet would run as a formula', () => {
    for (const attack of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(attack).startsWith(`"'`)).toBe(true);
    }
    // Numbers stay numbers: a negative count is not text from a person.
    expect(csvCell(-3)).toBe('"-3"');
  });

  it('joins rows with CRLF', () => {
    expect(csvText([['a', 'b'], ['=c', null]])).toBe('"a","b"\r\n"\'=c",""');
  });
});
