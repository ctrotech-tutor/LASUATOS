import {
  CONTACT_HANDLED_KEEP_DAYS,
  CONTACT_PRIVACY_REQUEST_LABELS,
  CONTACT_REFERENCE_PATTERN,
  CONTACT_ROLE_LABELS,
  CONTACT_TOPIC_LABELS,
  CONTACT_TOPICS,
  contactReplyDue,
  type ContactInbox,
  type ContactMessage,
  type ContactPrivacyRequest,
  type ContactTopic,
} from '@lasuatos/contracts';

export const PATH = '/admin/messages';
export const INBOX_PREFIX = 'admin:messages:';
export const MESSAGE_PREFIX = 'admin:message:';

const DAY = 86_400_000;

export type Show = 'new' | 'handled' | 'all';
export const SHOWS: readonly Show[] = ['new', 'handled', 'all'];

/** Everything the address bar holds: `?show=handled&topic=privacy&q=face&message=LA-7K3P9Q`. */
export type View = {
  readonly show: Show;
  readonly topic: ContactTopic | null;
  readonly q: string;
  readonly message: string | null;
};

export function readView(params: { get(name: string): string | null } | null): View {
  const show = params?.get('show');
  const topic = params?.get('topic');
  const message = params?.get('message')?.trim().toUpperCase() ?? '';
  return {
    show: show === 'handled' || show === 'all' ? show : 'new',
    topic: topic && (CONTACT_TOPICS as readonly string[]).includes(topic) ? topic as ContactTopic : null,
    q: (params?.get('q') ?? '').slice(0, 100),
    message: CONTACT_REFERENCE_PATTERN.test(message) ? message : null,
  };
}

/** Defaults stay out of the address, so `/admin/messages` is the new messages. */
export function viewHref(path: string, view: View): string {
  const params = new URLSearchParams();
  if (view.show !== 'new') params.set('show', view.show);
  if (view.topic) params.set('topic', view.topic);
  if (view.q.trim()) params.set('q', view.q.trim());
  if (view.message) params.set('message', view.message);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const inboxKey = (view: Pick<View, 'show' | 'topic' | 'q'>) => `${INBOX_PREFIX}${view.show}:${view.topic ?? ''}:${view.q.trim().toLowerCase()}`;
export const messageKey = (reference: string) => `${MESSAGE_PREFIX}${reference}`;

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

/** Short names for chips, rows and the topic picker. */
export const TOPIC_SHORT: Readonly<Record<ContactTopic, string>> = {
  adoption: 'New department',
  problem: 'Problem',
  account: 'Account',
  privacy: 'Privacy',
  other: 'Other',
};

export const PRIVACY_SHORT: Readonly<Record<ContactPrivacyRequest, string>> = {
  copy: 'Copy of their data',
  correct: 'Correct their details',
  delete_face: 'Delete face data',
  object: 'Objection',
  other: 'Privacy question',
};

export const topicLine = (message: Pick<ContactMessage, 'topic' | 'privacyRequest'>) =>
  message.topic === 'privacy' && message.privacyRequest ? `Privacy: ${PRIVACY_SHORT[message.privacyRequest]}` : CONTACT_TOPIC_LABELS[message.topic];

/** The message on one line, for the list. */
export function preview(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const TITLES = /^(dr|prof|professor|mr|mrs|ms|miss|engr|arc|pastor|chief|alhaji|alhaja|barr)\.?$/i;

/** "Dr. Ada Bello-Ojo" → "Dr Bello-Ojo"; "Chioma Okafor" → "Chioma". */
export function greetingName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? name;
  if (TITLES.test(first) && words.length > 1) return `${first.replace(/\.$/, '')} ${words.at(-1)}`;
  return first;
}

/* ---------- Times ---------- */

const timeOfDay = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Africa/Lagos' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const fullWhen = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });

const dayNumber = (time: number) => Math.floor(Date.parse(`${lagosDay.format(time)}T00:00:00Z`) / DAY);
/** Whole calendar days (in Lagos) from `from` to `to`. */
export const calendarDays = (from: string | number, to: number) => dayNumber(to) - dayNumber(typeof from === 'number' ? from : Date.parse(from));

/** Like a mail app: 14:05 today, Yesterday, Mon this week, 12 Oct, then 12 Oct 2025. */
export function listTime(iso: string, now: number): string {
  const days = calendarDays(iso, now);
  const at = Date.parse(iso);
  if (days <= 0) return timeOfDay.format(at);
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekday.format(at);
  return days < 300 ? dayMonth.format(at) : dayMonthYear.format(at);
}

export const fullDate = (iso: string | number) => fullWhen.format(typeof iso === 'number' ? iso : Date.parse(iso)).replace(' at ', ', ');
export const shortDate = (time: string | number, now: number) => {
  const at = typeof time === 'number' ? time : Date.parse(time);
  return Math.abs(calendarDays(at, now)) < 300 ? dayMonth.format(at) : dayMonthYear.format(at);
};

/** "just now", "25 minutes ago", "3 hours ago", "yesterday", "4 days ago". */
export function agoLabel(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && calendarDays(iso, now) === 0) return `${plural(hours, 'hour')} ago`;
  const days = calendarDays(iso, now);
  if (days <= 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "under an hour", "5 hours", "1 day", "3 days". */
export function durationLabel(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return plural(Math.round(hours), 'hour');
  return plural(Math.max(1, Math.round(hours / 24)), 'day');
}

/* ---------- Reply dates ---------- */

export type Due = {
  readonly due: number;
  readonly overdue: boolean;
  /** danger: a privacy request close to (or past) its 30 days; warning: other messages past two working days. */
  readonly tone: 'danger' | 'warning' | 'neutral';
  /** For a badge: "Overdue", "4 days left". */
  readonly short: string;
  /** For the message: "Reply by Tue 17 Nov, 30 days after it arrived". */
  readonly long: string;
  /** For a list: "Reply by Tue 17 Nov" or "Was due Fri 13 Nov". */
  readonly brief: string;
};

/** When a new message should be answered, and how close that is. Null once handled. */
export function dueState(message: Pick<ContactMessage, 'topic' | 'createdAt' | 'status'>, now: number): Due | null {
  if (message.status !== 'new') return null;
  const due = contactReplyDue(message).getTime();
  const overdue = due < now;
  const days = calendarDays(now, due);
  const date = `${weekday.format(due)} ${shortDate(due, now)}`;
  const brief = overdue ? `Was due ${date}` : `Reply by ${date}`;
  if (message.topic === 'privacy') {
    const tone = overdue || days <= 7 ? 'danger' : days <= 14 ? 'warning' : 'neutral';
    if (overdue) return { due, overdue, tone, brief, short: 'Overdue', long: `The 30 days ran out on ${date}` };
    const left = days <= 0 ? 'Due today' : days === 1 ? '1 day left' : `${days} days left`;
    return { due, overdue, tone, brief, short: left, long: `Reply by ${date}, 30 days after it arrived` };
  }
  if (overdue) {
    const late = calendarDays(due, now);
    return { due, overdue, tone: 'warning', brief, short: 'Overdue', long: late <= 0 ? 'The reply was due earlier today' : `The reply was due ${late === 1 ? 'yesterday' : `${late} days ago`}, on ${date}` };
  }
  return { due, overdue, tone: 'neutral', brief, short: days <= 0 ? 'Due today' : `Due ${weekday.format(due)}`, long: `Reply by ${date} (two working days)` };
}

/** When a handled message is deleted. */
export const deletedOn = (handledAt: string) => Date.parse(handledAt) + CONTACT_HANDLED_KEEP_DAYS * DAY;

/* ---------- Facts ---------- */

export type Fact = { readonly label: string; readonly value: string; readonly mono?: boolean };

export function factsOf(message: ContactMessage): Fact[] {
  const facts: (Fact | null)[] = [
    message.role ? { label: 'They are', value: CONTACT_ROLE_LABELS[message.role] } : null,
    message.department ? { label: 'Department or unit', value: message.department } : null,
    message.matricNumber ? { label: 'Matric number', value: message.matricNumber, mono: true } : null,
    message.privacyRequest ? { label: 'Request', value: CONTACT_PRIVACY_REQUEST_LABELS[message.privacyRequest].replace(/\bmy\b/g, 'their').replace(/\bme\b/g, 'them') } : null,
    message.students ? { label: 'Students', value: `About ${message.students.toLocaleString('en-NG')}` } : null,
    message.page ? { label: 'Where it happened', value: message.page } : null,
    message.device ? { label: 'Device', value: message.device } : null,
  ];
  return facts.filter((fact): fact is Fact => fact !== null);
}

/** Checking who sent it matters before acting on an account or someone's data. */
export const needsIdentityCheck = (message: Pick<ContactMessage, 'topic' | 'signedIn'>) =>
  !message.signedIn && (message.topic === 'privacy' || message.topic === 'account');

/* ---------- Replies ---------- */

export type Starter = { readonly id: string; readonly label: string; readonly text: string };

/**
 * Ways to start a reply. The first is always a blank reply; the others are a first draft for
 * the common answers, to be read and changed in the mail app before sending.
 */
export function startersFor(message: ContactMessage): Starter[] {
  const starters: Starter[] = [{ id: 'reply', label: 'Reply by email', text: '' }];
  if (needsIdentityCheck(message)) {
    starters.push({
      id: 'verify',
      label: 'Ask them to confirm it’s them',
      text: `Thank you for your message. Before we act on it, we need to be sure it comes from you. Please reply from the email address on your LASUATOS account${message.matricNumber ? '' : ' and include your matric number'}. If you can no longer use that address, tell us your full name, matric number and department, and we will confirm who you are with your HOC.`,
    });
  }
  if (message.topic === 'privacy') {
    const done: Record<ContactPrivacyRequest, string> = {
      delete_face: 'Your registered face and any check-in photos have been deleted from LASUATOS. If you take attendance with LASUATOS again, you will be asked to register your face again first.',
      copy: 'Attached is a copy of the data LASUATOS holds about you: your account details, your class list entries and your attendance records.',
      correct: 'We have corrected your details. You will see the change the next time you sign in.',
      object: 'We have looked into your objection. This is what we have done:',
      other: 'We have looked into your question. This is what we found:',
    };
    starters.push({ id: 'done', label: 'Say it’s done', text: done[message.privacyRequest ?? 'other'] });
  }
  if (message.topic === 'problem') {
    starters.push({
      id: 'detail',
      label: 'Ask for more detail',
      text: 'Thank you for telling us. To find out what went wrong, could you tell us the course code and the time of the class, what you saw on the screen (a screenshot helps), and whether it happens every time?',
    });
  }
  if (message.topic === 'adoption') {
    starters.push({
      id: 'call',
      label: 'Suggest a call',
      text: `Thank you for your interest in LASUATOS${message.department ? ` for ${message.department}` : ''}. The quickest way to start is a short call with your HOD and a class rep: we set up the department, load the class lists and show lecturers how to take attendance. Which day this week or next suits you?`,
    });
  }
  return starters;
}

const MAX_QUOTE = 900;

/** A mailto: link with the subject, a greeting, the draft, a signature and the message quoted. */
export function replyHref(message: ContactMessage, starter: Starter, signature: string): string {
  const subject = `Re: ${CONTACT_TOPIC_LABELS[message.topic]} [${message.reference}]`;
  let original = message.message.trim();
  if (original.length > MAX_QUOTE) original = `${original.slice(0, MAX_QUOTE).trimEnd()}…`;
  const quoted = original.split('\n').slice(0, 14).map((line) => `> ${line}`).join('\n');
  const body = [
    `Hello ${greetingName(message.name)},`,
    '',
    starter.text || '',
    '',
    'Kind regards,',
    signature,
    'LASUATOS team',
    '',
    `On ${fullDate(message.createdAt)}, you wrote (reference ${message.reference}):`,
    quoted,
  ].join('\n');
  return `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------- Keeping the list right after a change ---------- */

/** The inbox after one message changed, before the server's fresh answer arrives. */
export function applyChange(inbox: ContactInbox, show: Show, before: ContactMessage, after: ContactMessage): ContactInbox {
  const moved = before.status !== after.status;
  const leaves = moved && show !== 'all' && show !== after.status;
  const delta = moved ? (after.status === 'handled' ? 1 : -1) : 0;
  const newByTopic = { ...inbox.summary.newByTopic, [after.topic]: Math.max(0, inbox.summary.newByTopic[after.topic] - delta) };
  const gone = (item: { id: string }) => !(after.status === 'handled' && item.id === after.id);
  return {
    ...inbox,
    counts: { new: Math.max(0, inbox.counts.new - delta), handled: Math.max(0, inbox.counts.handled + delta) },
    messages: leaves ? inbox.messages.filter((item) => item.id !== after.id) : inbox.messages.map((item) => (item.id === after.id ? after : item)),
    summary: {
      ...inbox.summary,
      newByTopic,
      privacyOpen: inbox.summary.privacyOpen.filter(gone),
      overdueOldest: inbox.summary.overdueOldest.filter(gone),
      handledLast30Days: Math.max(0, inbox.summary.handledLast30Days + delta),
    },
  };
}

/** The message to show after this one leaves the list: the next one down, else the one above. */
export function neighbourAfter(messages: readonly ContactMessage[], id: string): ContactMessage | null {
  const index = messages.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return messages[index + 1] ?? messages[index - 1] ?? null;
}

/* ---------- Clipboard ---------- */

/** Copies text, falling back to a hidden text area where the Clipboard API is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, or the page lost focus): try the old way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  (document.querySelector('dialog[open]') ?? document.body).append(area);
  area.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  active?.focus({ preventScroll: true });
  return done;
}
