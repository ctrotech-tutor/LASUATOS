/** Dates and wording for LASU mail. Times are Lagos time, like the rest of the app. */

const ZONE = 'Africa/Lagos';

const dayKey = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const time = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const long = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** In the list: "14:05" today, "Yesterday", "12 Nov" this year, "12 Nov 2025" before. */
export function listDate(at: number, now: number): string {
  if (!at) return '';
  const day = dayKey.format(at);
  if (day === dayKey.format(now)) return time.format(at);
  if (day === dayKey.format(now - 24 * 60 * 60 * 1000)) return 'Yesterday';
  return dayKey.format(at).slice(-4) === dayKey.format(now).slice(-4) ? dayMonth.format(at) : fullDate.format(at);
}

/** In an open email: "Tue, 10 Nov 2026, 14:05". */
export function longDate(at: number): string {
  return at ? long.format(at) : '';
}

export type Folder = 'inbox' | 'unread' | 'lasu' | 'starred';

/** Gmail searches behind each folder. "From LASU" is any lasu.edu.ng sender, staff or student. */
export const FOLDER_QUERY: Readonly<Record<Folder, string>> = {
  inbox: 'in:inbox',
  unread: 'in:inbox is:unread',
  lasu: 'from:lasu.edu.ng',
  starred: 'is:starred',
};

export const FOLDER_LABEL: Readonly<Record<Folder, string>> = {
  inbox: 'Inbox',
  unread: 'Unread',
  lasu: 'From LASU',
  starred: 'Starred',
};

export const EMPTY_TEXT: Readonly<Record<Folder, { title: string; body: string }>> = {
  inbox: { title: 'Your inbox is empty', body: 'New emails to your LASU address show up here.' },
  unread: { title: 'All caught up', body: 'No unread emails in your inbox.' },
  lasu: { title: 'Nothing from LASU yet', body: 'Emails from lasu.edu.ng addresses (lecturers, departments, the university) show up here.' },
  starred: { title: 'No starred emails', body: 'Emails you star in Gmail show up here.' },
};

/** A Gmail web link for this mailbox (and message), for replying or anything else read-only can't do. */
export function gmailLink(mailbox: string | null, messageId?: string): string {
  const base = `https://mail.google.com/mail/${mailbox ? `?authuser=${encodeURIComponent(mailbox)}` : ''}`;
  return messageId ? `${base}#all/${encodeURIComponent(messageId)}` : base;
}

/** A file name that is safe to save. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
  return cleaned.slice(0, 150) || 'attachment';
}
