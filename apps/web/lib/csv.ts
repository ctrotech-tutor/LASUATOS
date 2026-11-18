/**
 * One CSV cell for files staff open in Excel or Google Sheets: always quoted
 * (RFC 4180), with formula-looking text defused. Names, titles, emails and
 * typed numbers come from people, and a cell beginning with = + - @, a tab or
 * a carriage return would be run as a formula (CSV injection), so it gets a
 * leading apostrophe and is shown as text. Same rule as the API's exports.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to CSV text, one line per row (CRLF, as spreadsheets expect). */
export function csvText(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
