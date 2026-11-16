/**
 * Every email LASUATOS sends: subject, inbox preview and content. Layout and
 * styling live in design.ts so all messages look and read the same way.
 */
import type { ContactReceipt, ContactTeamNotice } from '../contact/service.js';
import type { OperatorAlertEmail } from '../monitoring/alerts.js';
import { renderEmail, strong, type Block, type EmailContent, type Fact, type Rich } from './design.js';
import type {
  DisputeResolvedNoticeEmail,
  DisputeSubmittedNoticeEmail,
  PasswordResetEmail,
  SecurityNoticeEmail,
  SecurityNoticeKind,
  StaffInvitationEmail,
  StudentEmailCodeEmail,
  VerificationEmail,
} from './transport.js';

export interface OutgoingMessage {
  readonly to: string;
  readonly displayName: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Where a reply goes (contact messages: the person who wrote in). */
  readonly replyTo?: { readonly email: string; readonly name: string } | undefined;
}

/** Tokens travel in the URL fragment so they never reach server or proxy logs. */
export function fragmentLink(publicAppUrl: string, path: string, token: string): string {
  const url = new URL(path, publicAppUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

const lagosDateTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Lagos',
});

/** "Sat, 14 Nov 2026, 14:05 WAT": Lagos time, said plainly. */
export function lagosWhen(date: Date): string {
  return `${lagosDateTime.format(date)} WAT`;
}

function message(
  to: string,
  displayName: string,
  subject: string,
  content: EmailContent,
  publicAppUrl: string | undefined,
  replyTo?: OutgoingMessage['replyTo'],
): OutgoingMessage {
  return { to, displayName, subject, ...(replyTo ? { replyTo } : {}), ...renderEmail(subject, content, publicAppUrl) };
}

const NEVER_ASKS = 'LASUATOS staff will never ask you for your password.';

// ---------------------------------------------------------------- accounts

export function verificationMessage(email: VerificationEmail, publicAppUrl: string): OutgoingMessage {
  return message(email.to, email.displayName, 'Confirm your LASUATOS email address', {
    preheader: 'One step left to finish your student account. The link works for 30 minutes.',
    kicker: 'Student account',
    heading: 'Confirm your email address',
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: 'You’re one step away from your LASUATOS student account. Confirm that this is your email address:' },
      { kind: 'button', label: 'Confirm email address', url: fragmentLink(publicAppUrl, '/verify-email', email.token) },
      { kind: 'paragraph', muted: true, content: 'This link expires in 30 minutes and can only be used once.' },
      {
        kind: 'callout',
        tone: 'info',
        title: 'What this confirms',
        content: 'Email confirmation verifies access to this mailbox only. It does not verify LASU student status or the matric number you entered.',
      },
    ],
    reason: 'You’re getting this because someone used this email address to open a LASUATOS student account. If it wasn’t you, ignore this email and nothing will happen.',
  }, publicAppUrl);
}

const CODE_COPY: Record<StudentEmailCodeEmail['purpose'], {
  readonly kicker: string;
  readonly heading: string;
  readonly preheader: string;
  readonly intro: string;
  readonly extra?: string;
  readonly warning: { readonly tone: 'neutral' | 'warning' | 'danger'; readonly title: string; readonly body: string };
}> = {
  open: {
    kicker: 'Open your account',
    heading: 'Your code to open your account',
    preheader: 'Enter it in LASUATOS to open your attendance account.',
    intro: 'Enter this code in LASUATOS to confirm this is your LASU student email and open your attendance account.',
    warning: {
      tone: 'neutral',
      title: 'Didn’t ask for this?',
      body: 'Someone may have typed your matric number by mistake. You can ignore this email. If it keeps happening, tell your HOC.',
    },
  },
  move: {
    kicker: 'Confirm your LASU email',
    heading: 'Your code to confirm your LASU email',
    preheader: 'Enter it in LASUATOS to use this LASU email on your account.',
    intro: 'Enter this code in LASUATOS to confirm this is your LASU student email. Your attendance account will use it from now on.',
    warning: {
      tone: 'neutral',
      title: 'Didn’t ask for this?',
      body: 'Someone may have typed your matric number by mistake. You can ignore this email. If it keeps happening, tell your HOC.',
    },
  },
  face: {
    kicker: 'New face photos',
    heading: 'Your code to take new face photos',
    preheader: 'Enter it in LASUATOS to replace the face on your account.',
    intro: 'Enter this code in LASUATOS to confirm you want to replace the face registered on your attendance account.',
    warning: {
      tone: 'danger',
      title: 'Didn’t ask for this?',
      body: 'Someone may know your password. Change it now from your account page in LASUATOS (Security), and tell your HOC.',
    },
  },
  reset: {
    kicker: 'Reset your password',
    heading: 'Your code to reset your password',
    preheader: 'Enter it in LASUATOS to choose a new password.',
    intro: 'Enter this code in LASUATOS to choose a new password for your attendance account.',
    extra: 'Choosing a new password signs you out on every device.',
    warning: {
      tone: 'neutral',
      title: 'Didn’t ask for this?',
      body: 'Ignore this email. Your password does not change unless someone enters this code.',
    },
  },
};

export function studentEmailCodeMessage(email: StudentEmailCodeEmail, publicAppUrl?: string): OutgoingMessage {
  const copy = CODE_COPY[email.purpose];
  const expiry = `Expires in ${email.expiresInMinutes} minutes`;
  return message(email.to, email.displayName, `${email.code} is your LASUATOS code`, {
    preheader: `${copy.preheader} ${expiry}.`,
    kicker: copy.kicker,
    heading: copy.heading,
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: copy.intro },
      { kind: 'code', label: 'Your code', value: email.code, caption: expiry },
      ...(copy.extra ? [{ kind: 'paragraph', content: copy.extra } satisfies Block] : []),
      { kind: 'paragraph', muted: true, content: 'Keep it to yourself. Nobody from LASUATOS will ever ask you for it, not even a lecturer, class rep or administrator.' },
      { kind: 'callout', tone: copy.warning.tone, title: copy.warning.title, content: copy.warning.body },
    ],
    reason: 'You’re getting this because a code was requested for this email address in LASUATOS.',
    footer: 'no-links',
  }, publicAppUrl);
}

export function passwordResetMessage(email: PasswordResetEmail, publicAppUrl: string): OutgoingMessage {
  return message(email.to, email.displayName, 'Reset your LASUATOS password', {
    preheader: 'Choose a new password. The link works for 30 minutes.',
    kicker: 'Account security',
    heading: 'Reset your password',
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: 'Someone asked to reset the password for your LASUATOS account. If it was you, choose a new one:' },
      { kind: 'button', label: 'Choose a new password', url: fragmentLink(publicAppUrl, '/reset-password', email.token) },
      { kind: 'paragraph', muted: true, content: 'This link expires in 30 minutes and can only be used once. Resetting your password signs you out on every device.' },
      { kind: 'callout', tone: 'neutral', title: 'Didn’t ask for this?', content: `Ignore this email; your password will not change. ${NEVER_ASKS}` },
    ],
    reason: 'You’re getting this because a password reset was requested for this email address on the LASUATOS sign-in page.',
  }, publicAppUrl);
}

function firstStepFor(roleLabel: string): Rich {
  const role = roleLabel.toLowerCase();
  if (role.includes('lecturer')) return ['Open ', strong('Take attendance'), ' and start your first lecture.'];
  if (role.includes('administrator')) return ['Open ', strong('Administration'), ' to set up your area: staff, class lists and courses.'];
  return 'Your workspace opens as soon as you sign in.';
}

export function staffInvitationMessage(email: StaffInvitationEmail, publicAppUrl: string): OutgoingMessage {
  const inviter = email.invitedByName ? `${email.invitedByName} has invited you` : 'You have been invited';
  const expires = lagosWhen(email.expiresAt);
  const facts: Fact[] = [
    { label: 'Role', value: email.roleLabel },
    { label: 'Responsible for', value: email.scopeLabel },
    ...(email.invitedByName ? [{ label: 'Invited by', value: email.invitedByName }] : []),
    { label: 'Invitation expires', value: expires },
  ];
  return message(email.to, email.displayName, `Your LASUATOS ${email.roleLabel.toLowerCase()} invitation`, {
    preheader: `${email.invitedByName ? `${email.invitedByName} invited you` : 'You’re invited'} to join as ${email.roleLabel} for ${email.scopeLabel}. Accept by ${expires}.`,
    kicker: 'Staff invitation',
    heading: 'You’re invited to LASUATOS',
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: [`${inviter} to join LASUATOS, the attendance system at `, strong(email.institutionName), '. Choose a password to activate your account.'] },
      { kind: 'facts', rows: facts },
      { kind: 'button', label: 'Accept invitation', url: fragmentLink(publicAppUrl, '/accept-invitation', email.token) },
      {
        kind: 'steps',
        title: 'What happens next',
        items: [
          'Choose a password. Your account is ready straight away.',
          ['Sign in any time with ', strong(email.to), '.'],
          firstStepFor(email.roleLabel),
        ],
      },
      { kind: 'paragraph', muted: true, content: 'The invitation link works once.' },
      { kind: 'callout', tone: 'neutral', title: 'Not expecting this?', content: `Ignore this email and no account will be created. ${NEVER_ASKS}` },
    ],
    reason: `You’re getting this because someone at ${email.institutionName} invited this email address to LASUATOS.`,
  }, publicAppUrl);
}

const NOTICE_COPY: Record<SecurityNoticeKind, {
  readonly subject: string;
  readonly heading: string;
  readonly preheader: string;
  readonly what: string;
  readonly matric: boolean;
  readonly blocks: readonly Block[];
  readonly reason: string;
}> = {
  password_reset: {
    subject: 'Your LASUATOS password was reset',
    heading: 'Your password was reset',
    preheader: 'Every signed-in device was signed out. If this wasn’t you, act now.',
    what: 'The password for your LASUATOS account was reset, and every signed-in device was signed out.',
    matric: false,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Reset your password straight away from the LASUATOS sign-in page, then tell your department’s LASUATOS administrator.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this email address.',
  },
  password_changed: {
    subject: 'Your LASUATOS password was changed',
    heading: 'Your password was changed',
    preheader: 'Other signed-in devices were signed out. If this wasn’t you, act now.',
    what: 'The password for your LASUATOS account was changed. Other signed-in devices were signed out.',
    matric: false,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Reset your password straight away from the LASUATOS sign-in page, then tell your department’s LASUATOS administrator.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this email address.',
  },
  account_taken_over: {
    subject: 'A LASUATOS account no longer uses this email',
    heading: 'This email was removed from an account',
    preheader: 'The student on the class list opened the account with their LASU email.',
    what: 'The student on the class list for this matric number opened its LASUATOS account by confirming their own LASU email. This address was never confirmed on the account, so it was removed and the account was signed out everywhere.',
    matric: true,
    blocks: [
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Is this your matric number?',
        content: 'Then tell your HOC straight away: they can check the class list and give you a setup code.',
      },
      { kind: 'paragraph', muted: true, content: 'If it isn’t yours, no action is needed. You can open your own account with your own matric number.' },
    ],
    reason: 'You’re getting this because this email address was on that LASUATOS account.',
  },
  account_released: {
    subject: 'Your LASUATOS student account was released',
    heading: 'An administrator released this account',
    preheader: 'This email can no longer sign in to the account for this matric number.',
    what: 'A LASUATOS administrator released this student account from your email address, so the student on the class list can open it. It was signed out everywhere and this address can no longer sign in to it.',
    matric: true,
    blocks: [
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Is this your matric number?',
        content: 'Then contact your department’s LASUATOS administrator or your HOC straight away.',
      },
      { kind: 'paragraph', muted: true, content: 'If it isn’t yours, no action is needed. You can open your own account with your own matric number.' },
    ],
    reason: 'You’re getting this because this email address was on that LASUATOS account.',
  },
};

export function securityNoticeMessage(email: SecurityNoticeEmail, publicAppUrl?: string): OutgoingMessage {
  const copy = NOTICE_COPY[email.kind];
  const facts: Fact[] = [
    { label: 'When', value: lagosWhen(email.occurredAt) },
    ...(copy.matric ? [{ label: 'Matric number', value: email.matricNumber ?? 'Not recorded', mono: true }] : [{ label: 'Account', value: email.to }]),
  ];
  return message(email.to, email.displayName, copy.subject, {
    preheader: copy.preheader,
    kicker: 'Account security',
    heading: copy.heading,
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: copy.what },
      { kind: 'facts', rows: facts },
      ...copy.blocks,
    ],
    reason: copy.reason,
    footer: 'no-links',
  }, publicAppUrl);
}

// -------------------------------------------------------------- attendance

function lectureFacts(courseCode: string, sessionTitle: string, startsAt: Date): Fact[] {
  return [
    { label: 'Course', value: courseCode },
    { label: 'Lecture', value: sessionTitle },
    { label: 'Held on', value: lagosWhen(startsAt) },
  ];
}

export function disputeSubmittedMessage(email: DisputeSubmittedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  const others = email.openDisputeCount - 1;
  return message(email.to, email.displayName, `Attendance dispute: ${email.courseCode} · ${email.sessionTitle}`, {
    preheader: `${email.studentName} asked to be marked present. Review it on your disputes page.`,
    kicker: 'Attendance dispute',
    heading: 'A student disputed their attendance',
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: [strong(email.studentName), ' has disputed their attendance for this lecture. Read their statement and decide whether to mark them present:'] },
      { kind: 'facts', rows: [{ label: 'Student', value: email.studentName }, ...lectureFacts(email.courseCode, email.sessionTitle, email.sessionStartsAt)] },
      { kind: 'button', label: 'Review disputes', url: new URL('/lecturer/disputes', publicAppUrl).toString(), fallback: false },
      {
        kind: 'paragraph',
        muted: true,
        content: others > 0
          ? `You have ${others} other open ${others === 1 ? 'dispute' : 'disputes'} waiting as well.`
          : 'This is your only open dispute right now.',
      },
    ],
    reason: 'You’re getting this because you teach this course. To keep your inbox quiet, LASUATOS emails you once when the first dispute for a lecture arrives; later disputes for the same lecture appear on your disputes page without another email.',
  }, publicAppUrl);
}

export function disputeResolvedMessage(email: DisputeResolvedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  const upheld = email.decision === 'upheld';
  return message(
    email.to,
    email.displayName,
    upheld ? `Dispute accepted: ${email.courseCode} · ${email.sessionTitle}` : `Dispute not accepted: ${email.courseCode} · ${email.sessionTitle}`,
    {
      preheader: upheld
        ? `You’re now marked present for ${email.courseCode} · ${email.sessionTitle}.`
        : `Your attendance for ${email.courseCode} · ${email.sessionTitle} is unchanged.`,
      kicker: 'Attendance dispute',
      heading: upheld ? 'Your attendance dispute was accepted' : 'Your attendance dispute was not accepted',
      greeting: email.displayName,
      blocks: [
        upheld ? { kind: 'status', tone: 'success', label: 'Marked present' } : { kind: 'status', tone: 'neutral', label: 'Record unchanged' },
        {
          kind: 'paragraph',
          content: upheld
            ? [strong(email.lecturerName), ' accepted your dispute. You are now marked present for this lecture.']
            : [strong(email.lecturerName), ' did not accept your dispute. Your attendance record for this lecture is unchanged.'],
        },
        { kind: 'facts', rows: lectureFacts(email.courseCode, email.sessionTitle, email.sessionStartsAt) },
        { kind: 'quote', text: email.note, cite: `Note from ${email.lecturerName}` },
        { kind: 'button', label: 'View my attendance', url: new URL('/attendance', publicAppUrl).toString(), fallback: false },
        ...(upheld ? [] : [{ kind: 'paragraph', muted: true, content: 'If you think a mistake has been made, speak to your lecturer or your department.' } satisfies Block]),
      ],
      reason: 'You’re getting this because you disputed your attendance for this lecture.',
    },
    publicAppUrl,
  );
}

// ------------------------------------------------------------------ contact

export function contactTeamMessage(notice: ContactTeamNotice, publicAppUrl: string): OutgoingMessage {
  const snippet = notice.message.replace(/\s+/g, ' ').trim();
  return message(
    notice.to.email,
    notice.to.displayName,
    `[${notice.reference}] ${notice.topicLabel}: ${notice.senderName}`.slice(0, 160),
    {
      preheader: `${notice.senderName}: ${snippet.length > 120 ? `${snippet.slice(0, 117)}…` : snippet}`,
      kicker: `Contact page · ${notice.reference}`,
      heading: `New message: ${notice.topicLabel}`,
      greeting: notice.to.displayName,
      blocks: [
        { kind: 'paragraph', content: [strong(notice.senderName), ' wrote to the LASUATOS team. Reply to this email to answer them directly.'] },
        { kind: 'quote', text: notice.message, cite: `${notice.senderName} · ${lagosWhen(notice.receivedAt)}` },
        {
          kind: 'facts',
          rows: [
            { label: 'From', value: notice.senderName },
            { label: 'Email', value: notice.senderEmail },
            { label: 'Topic', value: notice.topicLabel },
            ...notice.facts,
            { label: 'Signed in', value: notice.signedIn ? 'Yes, to the account that uses this email' : 'No, so this email address is not confirmed' },
            { label: 'Reference', value: notice.reference, mono: true },
          ],
        },
        { kind: 'button', label: 'Open this message', url: new URL(`/admin/messages?message=${encodeURIComponent(notice.reference)}`, publicAppUrl).toString(), fallback: false },
        { kind: 'paragraph', muted: true, content: 'Once you’ve replied, mark it handled in Administration → Messages so other administrators know it’s done.' },
      ],
      reason: 'You’re getting this because you’re an institution administrator on LASUATOS. Handled messages are deleted after a year.',
    },
    publicAppUrl,
    { email: notice.senderEmail, name: notice.senderName },
  );
}

export function contactReceiptMessage(receipt: ContactReceipt, publicAppUrl?: string): OutgoingMessage {
  return message(receipt.to, receipt.name, `We got your message (${receipt.reference})`, {
    preheader: `Your reference is ${receipt.reference}. We usually reply within two working days.`,
    kicker: 'Contact',
    heading: 'We got your message',
    greeting: receipt.name,
    blocks: [
      { kind: 'paragraph', content: ['Thanks for writing to the LASUATOS team about ', strong(receipt.topicLabel), '.'] },
      { kind: 'code', size: 'medium', label: 'Your reference', value: receipt.reference, caption: 'Mention it if you write to us again.' },
      {
        kind: 'steps',
        title: 'What happens next',
        items: [
          'A LASUATOS administrator reads your message.',
          ['We reply to ', strong(receipt.to), ', usually within two working days.'],
          'No reply yet? Check your spam or junk folder.',
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'About an attendance entry?',
        content: 'A missing or wrong entry is fixed fastest by the lecturer or class rep who took that attendance, and a wrong name or matric number by your HOC.',
      },
    ],
    reason: 'You’re getting this because this email address was entered on the LASUATOS contact page. If you didn’t write to us, someone typed it by mistake and you can ignore this email.',
  }, publicAppUrl);
}

// --------------------------------------------------------------- operations

const ALERT_COPY: Record<OperatorAlertEmail['kind'], { subject: string; heading: string; intro: string; action: string; path: string; next: string }> = {
  server_error: {
    subject: 'Something failed on LASUATOS',
    heading: 'A request failed on the server',
    intro: 'Someone using LASUATOS hit an unexpected server error. They saw a generic “something went wrong” message.',
    action: 'Open the site',
    path: '/',
    next: 'Find the request ID in Vercel → your project → Logs to see the full error.',
  },
  page_error: {
    subject: 'A page crashed on LASUATOS',
    heading: 'A page crashed in someone’s browser',
    intro: 'A LASUATOS page stopped working in a user’s browser and showed the error screen.',
    action: 'Open the site',
    path: '/',
    next: 'Open the page named below and try the same steps. Vercel → your project → Logs may show a matching server error.',
  },
  schema_behind: {
    subject: 'LASUATOS database needs updating',
    heading: 'The database is behind this release',
    intro: 'The live site is running code that expects database updates that have not been applied, so newer features fail.',
    action: 'Check site status',
    path: '/api/v1/ready',
    next: 'Production deploys apply updates automatically: redeploy the latest production build, or run pnpm prod:migrate.',
  },
};

export function operatorAlertMessage(email: OperatorAlertEmail, publicAppUrl: string): OutgoingMessage {
  const copy = ALERT_COPY[email.kind];
  return message(email.to, 'LASUATOS operator', `${copy.subject}: ${email.summary}`.slice(0, 160), {
    preheader: `${email.summary} · ${lagosWhen(email.occurredAt)}`,
    kicker: 'Site alert',
    heading: copy.heading,
    blocks: [
      { kind: 'status', tone: email.kind === 'schema_behind' ? 'warning' : 'danger', label: email.kind === 'schema_behind' ? 'Action needed' : 'Error' },
      { kind: 'paragraph', content: copy.intro },
      {
        kind: 'facts',
        rows: [
          { label: 'What', value: email.summary, mono: true },
          { label: 'When', value: lagosWhen(email.occurredAt) },
          ...Object.entries(email.details).map(([label, value]) => ({ label, value, mono: true })),
        ],
      },
      { kind: 'callout', tone: 'info', title: 'Next step', content: copy.next },
      { kind: 'button', label: copy.action, url: new URL(copy.path, publicAppUrl).toString(), fallback: false },
      { kind: 'paragraph', muted: true, content: 'You get one email per problem at most every 30 minutes (page crashes: hourly; database updates: every 6 hours), and no more than 20 alerts a day.' },
    ],
    reason: 'You’re getting this because this address is listed in ALERT_EMAIL for this LASUATOS deployment.',
  }, publicAppUrl);
}

export function testMessage(to: string, provider: string, sentAt: Date, publicAppUrl?: string): OutgoingMessage {
  return message(to, to, 'LASUATOS email test', {
    preheader: `Sent through ${provider}. Account emails can reach this mailbox.`,
    kicker: 'Email test',
    heading: 'Email delivery works',
    blocks: [
      { kind: 'status', tone: 'success', label: 'Delivered' },
      { kind: 'paragraph', content: `This is a test message from LASUATOS, sent through ${provider}. If you can read it, sign-up confirmations, codes, password resets and staff invitations can reach this mailbox.` },
      { kind: 'facts', rows: [{ label: 'Provider', value: provider, mono: true }, { label: 'Sent', value: lagosWhen(sentAt) }, { label: 'To', value: to }] },
      { kind: 'paragraph', muted: true, content: 'You can delete this message. No account was created or changed.' },
    ],
    reason: 'You’re getting this because someone ran the LASUATOS email test for this address.',
  }, publicAppUrl);
}
