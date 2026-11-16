import { readAttendanceScan } from '@lasuatos/contracts';

/** How a class was opened: a scanned rotating QR (challenge), or a code (typed, or from a poster link). */
export type ScanSource = { readonly challenge?: string; readonly code?: string; readonly scanned?: boolean };

/** Codes are letters and numbers only: the screen shows 6, a printed poster 8. */
export const CODE_MAX = 12;

/** What the code box keeps: capitals and digits, nothing else, at most 12. */
export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_MAX);
}

/** A pasted link (or a scanned value) rather than a code someone is typing. */
export function looksLikeLink(raw: string): boolean {
  return /^\s*(https?:\/\/|lasu\d?\.)/i.test(raw) || raw.includes('/a/') || raw.includes('#lasu');
}

export type TypedCode =
  | { readonly kind: 'lecture'; readonly source: ScanSource }
  | { readonly kind: 'course'; readonly challenge: string }
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * Reads what was typed or pasted into the code box: a 6-character code from the screen, an
 * 8-character poster code, or a whole check-in link.
 */
export function readTypedCode(raw: string): TypedCode {
  const text = raw.trim();
  if (!text) return { kind: 'invalid', message: 'Type the code shown under the QR code.' };
  if (looksLikeLink(text)) {
    const scan = readAttendanceScan(text);
    if (scan?.kind === 'lecture') return { kind: 'lecture', source: { challenge: scan.challenge } };
    if (scan?.kind === 'course') return { kind: 'course', challenge: scan.challenge };
    if (scan?.kind === 'lecture_code') return { kind: 'lecture', source: { code: scan.code } };
    return { kind: 'invalid', message: 'That link is not a LASUATOS attendance link. Scan the QR code or type its code.' };
  }
  const code = cleanCode(text);
  if (code.length !== 6 && code.length !== 8) {
    return { kind: 'invalid', message: 'The code has 6 letters and numbers on the screen, or 8 on a poster.' };
  }
  return { kind: 'lecture', source: { code } };
}

/**
 * Where face setup sends the student afterwards: back to this class when it came from a poster
 * (its code still works), otherwise to the scanner (a screen's code will have changed).
 */
export function faceSetupHref(source: ScanSource | null): string {
  const code = source?.code;
  const next = code && code.length === 8 ? `/a/${code}` : '/a';
  return `/account/setup?next=${encodeURIComponent(next)}`;
}

/** "Closes 11:41", or a countdown in the last hour: "Closes in 12 min". */
export function closingLabel(endsAt: string, now: number, clock: (value: string) => string): string {
  const left = Date.parse(endsAt) - now;
  if (!now || !Number.isFinite(left)) return `Open until ${clock(endsAt)}`;
  if (left <= 0) return 'Closing now';
  const minutes = Math.ceil(left / 60_000);
  if (minutes <= 1) return 'Closes in under a minute';
  if (minutes < 60) return `Closes in ${minutes} min`;
  return `Open until ${clock(endsAt)}`;
}

/** "Dr. Ada Bello · Signals Laboratory": the line under the course title. */
export function courseLine(session: { readonly lecturerName: string | null; readonly venueName: string | null }): string {
  return [session.lecturerName, session.venueName].filter(Boolean).join(' · ');
}

/** The initials on the ticket: "Tolulope Adesewa Oyelaran" → "TO" (first and last name). */
export function ticketInitials(fullName: string): string {
  const words = fullName.split(/\s+/).map((word) => word.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return `${first}${last}`.toUpperCase();
}
