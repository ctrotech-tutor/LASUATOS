/**
 * Every email LASUATOS sends: subject, inbox preview and content. Layout and
 * styling live in design.ts so all messages look and read the same way.
 */
import { ATTENDANCE_APPEAL_WINDOW_DAYS } from '@lasuatos/contracts';
import type { ContactReceipt, ContactTeamNotice } from '../contact/service.js';
import type { OperatorAlertEmail } from '../monitoring/alerts.js';
import { renderEmail, strong, type Block, type EmailContent, type Fact, type Rich } from './design.js';
import type {
  AppealDecidedNoticeEmail,
  AppealSubmittedNoticeEmail,
  DisputeResolvedNoticeEmail,
  DisputeSubmittedNoticeEmail,
  PasswordResetEmail,
  SecurityNoticeEmail,
  SecurityNoticeKind,
  StaffInvitationEmail,
  StaffRoleChangedEmail,
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
  open_jamb: {
    kicker: 'Open your account',
    heading: 'Your code to open your account',
    preheader: 'Enter it in LASUATOS to open your attendance account.',
    intro: 'Enter this code in LASUATOS to confirm this email address and open your attendance account. You are on your class list by JAMB registration number, so this email stands in until you get your LASU email.',
    extra: 'When your matric number and LASU email arrive, add them from your account page. Your attendance stays with you.',
    warning: {
      tone: 'neutral',
      title: 'Didn’t ask for this?',
      body: 'Someone may have typed your JAMB number by mistake. You can ignore this email. If it keeps happening, tell your HOC.',
    },
  },
  matric: {
    kicker: 'Add your matric number',
    heading: 'Your code to add your matric number',
    preheader: 'Enter it in LASUATOS to switch your account to your matric number.',
    intro: 'Enter this code in LASUATOS to confirm this is your LASU student email. Your account then uses your matric number and this email; your attendance, courses and face stay.',
    warning: {
      tone: 'neutral',
      title: 'Didn’t ask for this?',
      body: 'Someone may have typed your LASU email by mistake. You can ignore this email. If it keeps happening, tell your HOC.',
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
  secondary: {
    kicker: 'Link your personal email',
    heading: 'Your code to link this personal email',
    preheader: 'Enter it in LASUATOS to link this email to your account.',
    intro: 'Enter this code in LASUATOS to confirm this personal email is yours and link it to your attendance account. Your codes and notices can then come here, and you can sign in with Google using this email.',
    extra: 'Your LASU email stays on your account as its official address.',
    warning: {
      tone: 'danger',
      title: 'Didn’t ask for this?',
      body: 'Do not share this code with anyone: whoever enters it links this mailbox to their account and can then sign in to it as you. Ignore this email and nothing happens.',
    },
  },
};

export function studentEmailCodeMessage(email: StudentEmailCodeEmail, publicAppUrl?: string): OutgoingMessage {
  const copy = CODE_COPY[email.purpose];
  const expiry = `Expires in ${email.expiresInMinutes} minutes`;
  // ADR 040: a code that confirms the LASU email can be delivered to the linked
  // personal email the student actually reads; the message then says both.
  const elsewhere = email.forEmail && email.forEmail.toLowerCase() !== email.to.toLowerCase() ? email.forEmail : null;
  return message(email.to, email.displayName, `${email.code} is your LASUATOS code`, {
    preheader: `${copy.preheader} ${expiry}.`,
    kicker: copy.kicker,
    heading: copy.heading,
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: copy.intro },
      ...(elsewhere ? [{ kind: 'paragraph', content: `It confirms your LASU email, ${elsewhere}. It came here because your account’s emails go to this personal email (you can switch that back on your account page).` } satisfies Block] : []),
      { kind: 'code', label: 'Your code', value: email.code, caption: expiry },
      ...(copy.extra ? [{ kind: 'paragraph', content: copy.extra } satisfies Block] : []),
      { kind: 'paragraph', muted: true, content: 'Keep it to yourself. Nobody from LASUATOS will ever ask you for it, not even a lecturer, class rep or administrator.' },
      { kind: 'callout', tone: copy.warning.tone, title: copy.warning.title, content: copy.warning.body },
    ],
    reason: elsewhere
      ? `You’re getting this because a code was requested for ${elsewhere} on your LASUATOS account, and your account’s emails go to this address.`
      : 'You’re getting this because a code was requested for this email address in LASUATOS.',
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

export function staffRoleChangedMessage(email: StaffRoleChangedEmail, publicAppUrl?: string): OutgoingMessage {
  const roleChanged = email.fromRoleLabel !== email.toRoleLabel;
  const facts: Fact[] = [
    { label: 'Now', value: `${email.toRoleLabel}, ${email.toScopeLabel}` },
    { label: 'Before', value: `${email.fromRoleLabel}, ${email.fromScopeLabel}` },
    { label: 'Changed by', value: email.changedByName },
    { label: 'When', value: lagosWhen(email.occurredAt) },
    { label: 'Why', value: email.reason },
  ];
  const workspace = email.toRoleLabel.toLowerCase().includes('administrator')
    ? ['Your menu now shows ', strong('Administration'), ' for your new area. Your account, password and history are the same.'] as Rich
    : ['Your menu now shows ', strong('Take attendance'), ' and your courses. Your account, password and history are the same.'] as Rich;
  return message(email.to, email.displayName, roleChanged ? `You’re now ${email.toRoleLabel.toLowerCase()} on LASUATOS` : 'Your LASUATOS area has changed', {
    preheader: `${email.changedByName} changed your LASUATOS role to ${email.toRoleLabel}, ${email.toScopeLabel}.`,
    kicker: 'Your role',
    heading: roleChanged ? 'Your role has changed' : 'Your area has changed',
    greeting: email.displayName,
    blocks: [
      { kind: 'paragraph', content: [`An administrator at `, strong(email.institutionName), ' changed what you do on LASUATOS. It applies straight away, with no new invitation.'] },
      { kind: 'facts', rows: facts },
      { kind: 'paragraph', content: workspace },
      ...(email.coursesLeft.length
        ? [{ kind: 'paragraph' as const, content: `You no longer teach ${email.coursesLeft.join(', ')} on LASUATOS. Past registers stay as they were.` }]
        : []),
      { kind: 'paragraph', muted: true, content: 'If a page looks out of date, refresh it or sign in again.' },
      { kind: 'callout', tone: 'neutral', title: 'Not expected?', content: `Ask ${email.changedByName} or your department’s LASUATOS administrator. ${NEVER_ASKS}` },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS staff account that uses this email address.',
    footer: 'no-links',
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
  matric_added: {
    subject: 'Your LASUATOS account now uses your matric number',
    heading: 'Your matric number was added',
    preheader: 'Your account switched from your JAMB number to your matric number and LASU email.',
    what: 'Your LASUATOS account switched from your JAMB registration number to your matric number, and now signs in with your LASU email. Your attendance, courses and face stayed with the account.',
    matric: true,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed. This email no longer signs in to the account; use your matric number or your LASU email.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Tell your HOC straight away: someone may have your password. They can check the class list with an administrator.',
      },
    ],
    reason: 'You’re getting this because this email address was the one on that LASUATOS account.',
  },
  secondary_email_added: {
    subject: 'A personal email was linked to your LASUATOS account',
    heading: 'A personal email was linked',
    preheader: 'Codes and notices can now go to it, and it can sign in with Google. If this wasn’t you, act now.',
    what: 'The personal email below was linked to your LASUATOS account. Whoever opens that mailbox can receive your codes and can sign in to your account with Google.',
    matric: true,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed. Your LASU email still signs in as before.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Someone is in your account. Sign in, remove the personal email in Account security, choose a new password and sign out every other device. Then tell your HOC.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this LASU email address.',
  },
  secondary_email_changed: {
    subject: 'The personal email on your LASUATOS account was changed',
    heading: 'Your personal email was changed',
    preheader: 'Codes and notices now go to the new one, and it can sign in with Google. If this wasn’t you, act now.',
    what: 'The personal email linked to your LASUATOS account was changed to the one below. Whoever opens that mailbox can receive your codes and can sign in to your account with Google.',
    matric: true,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed. The earlier personal email no longer signs in or receives your codes.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Someone is in your account. Sign in, remove the personal email in Account security, choose a new password and sign out every other device. Then tell your HOC.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this LASU email address.',
  },
  secondary_email_removed: {
    subject: 'The personal email was removed from your LASUATOS account',
    heading: 'Your personal email was removed',
    preheader: 'It no longer receives your codes and no longer signs in with Google.',
    what: 'The personal email below was removed from your LASUATOS account. Your codes and notices go to your LASU email again, and the removed address can no longer sign in with Google.',
    matric: true,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed.' },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Wasn’t you?',
        content: 'Someone may be signed in as you. Sign in, choose a new password and sign out every other device in Account security. Then tell your HOC.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this LASU email address.',
  },
  passkey_added: {
    subject: 'A passkey was added to your LASUATOS account',
    heading: 'A passkey was added',
    preheader: 'It can now sign in to your account. If this wasn’t you, act now.',
    what: 'A passkey was added to your LASUATOS account. Whoever has the device or password manager it was saved to can now sign in as you with a fingerprint, face or screen lock.',
    matric: false,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Sign in, remove the passkey in Account security, change your password and sign out every other device. Then tell your LASUATOS administrator.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this email address.',
  },
  passkey_removed: {
    subject: 'A passkey was removed from your LASUATOS account',
    heading: 'A passkey was removed',
    preheader: 'It can no longer sign in to your account.',
    what: 'A passkey was removed from your LASUATOS account and can no longer be used to sign in.',
    matric: false,
    blocks: [
      { kind: 'paragraph', content: 'If this was you, no action is needed. You can still sign in with your password or another passkey.' },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Wasn’t you?',
        content: 'Someone may be signed in as you. Sign in, change your password and sign out every other device in Account security.',
      },
    ],
    reason: 'You’re getting this because it’s about the LASUATOS account that uses this email address.',
  },
  password_sign_in: {
    subject: 'Your LASUATOS account was signed in with your password',
    heading: 'Signed in with your password',
    preheader: 'You have a passkey, but your password was used. If this wasn’t you, act now.',
    what: 'Someone signed in to your LASUATOS account with your password instead of your passkey. We tell you every time, because a passkey cannot be stolen by a fake website but a password can.',
    matric: false,
    blocks: [
      { kind: 'paragraph', content: 'If this was you (on a new device, for example), no action is needed. Next time, try “Sign in with a passkey”.' },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Wasn’t you?',
        content: 'Your password is known to someone else. Reset it from the LASUATOS sign-in page straight away: that signs out every device. Then tell your LASUATOS administrator.',
      },
    ],
    reason: 'You’re getting this because the LASUATOS account that uses this email address has a passkey.',
  },
};

export function securityNoticeMessage(email: SecurityNoticeEmail, publicAppUrl?: string): OutgoingMessage {
  const copy = NOTICE_COPY[email.kind];
  const facts: Fact[] = [
    { label: 'When', value: lagosWhen(email.occurredAt) },
    ...(copy.matric ? [{ label: 'Matric number', value: email.matricNumber ?? 'Not recorded', mono: true }] : [{ label: 'Account', value: email.to }]),
    ...(email.passkeyName ? [{ label: 'Passkey', value: email.passkeyName }] : []),
    ...(email.secondaryEmail ? [{ label: 'Personal email', value: email.secondaryEmail }] : []),
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
        ...(upheld ? [] : [{ kind: 'paragraph', muted: true, content: `If you think a mistake has been made, you can take this dispute to your department from My attendance within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days.` } satisfies Block]),
      ],
      reason: 'You’re getting this because you disputed your attendance for this lecture.',
    },
    publicAppUrl,
  );
}

export function appealSubmittedMessage(email: AppealSubmittedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  return message(email.to, email.displayName, `Attendance appeal: ${email.courseCode} · ${email.sessionTitle}`, {
    preheader: `${email.studentName} asked ${email.departmentName} to review a decision on their attendance.`,
    kicker: 'Attendance appeal',
    heading: 'A student took a dispute to the department',
    greeting: email.displayName,
    blocks: [
      {
        kind: 'paragraph',
        content: [strong(email.studentName), ' disputed their attendance for this lecture, the lecturer turned it down, and they have asked the department to look again. You can see the whole story, decide, and your decision is final:'],
      },
      { kind: 'facts', rows: [{ label: 'Student', value: email.studentName }, ...lectureFacts(email.courseCode, email.sessionTitle, email.sessionStartsAt), { label: 'Department', value: email.departmentName }] },
      { kind: 'button', label: 'Review appeals', url: new URL('/admin/appeals', publicAppUrl).toString(), fallback: false },
    ],
    reason: `You’re getting this because you look after ${email.departmentName} in LASUATOS. To keep your inbox quiet, you get one email when the department’s appeals list stops being empty; later appeals wait on the appeals page.`,
  }, publicAppUrl);
}

export function appealDecidedMessage(email: AppealDecidedNoticeEmail, publicAppUrl: string): OutgoingMessage {
  const upheld = email.decision === 'upheld';
  const lecture = `${email.courseCode} · ${email.sessionTitle}`;
  const student = email.audience === 'student';
  return message(
    email.to,
    email.displayName,
    student
      ? upheld ? `Appeal accepted: ${lecture}` : `Appeal not accepted: ${lecture}`
      : `Appeal decided: ${email.studentName}, ${lecture}`,
    {
      preheader: student
        ? upheld ? `You’re now marked present for ${lecture}.` : `${email.departmentName} kept the lecturer’s decision.`
        : upheld ? `${email.departmentName} marked ${email.studentName} present.` : `${email.departmentName} kept your decision.`,
      kicker: 'Attendance appeal',
      heading: student
        ? upheld ? 'Your appeal was accepted' : 'Your appeal was not accepted'
        : upheld ? 'The department accepted an appeal' : 'The department kept your decision',
      greeting: email.displayName,
      blocks: [
        upheld ? { kind: 'status', tone: 'success', label: 'Marked present' } : { kind: 'status', tone: 'neutral', label: 'Record unchanged' },
        {
          kind: 'paragraph',
          content: student
            ? upheld
              ? [strong(email.deciderName), ` reviewed your appeal for ${email.departmentName} and accepted it. You are now marked present for this lecture.`]
              : [strong(email.deciderName), ` reviewed your appeal for ${email.departmentName} and kept the lecturer’s decision. This decision is final.`]
            : upheld
              ? [strong(email.studentName), ' took the dispute you turned down to the department. ', strong(email.deciderName), ' accepted the appeal, so they are now marked present.']
              : [strong(email.studentName), ' took the dispute you turned down to the department. ', strong(email.deciderName), ' kept your decision.'],
        },
        { kind: 'facts', rows: [...(student ? [] : [{ label: 'Student', value: email.studentName }]), ...lectureFacts(email.courseCode, email.sessionTitle, email.sessionStartsAt)] },
        { kind: 'quote', text: email.note, cite: `Note from ${email.deciderName}` },
        student
          ? { kind: 'button', label: 'View my attendance', url: new URL('/attendance', publicAppUrl).toString(), fallback: false }
          : { kind: 'button', label: 'Open disputes', url: new URL('/lecturer/disputes', publicAppUrl).toString(), fallback: false },
      ],
      reason: student
        ? 'You’re getting this because you took an attendance dispute to your department.'
        : 'You’re getting this because you decided the original dispute.',
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
  email_failover: {
    subject: 'LASUATOS switched email provider',
    heading: 'An email provider stopped sending',
    intro: 'An email provider refused a message, so LASUATOS sent it through the next provider instead. Students still get their codes; nothing is lost.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'If the reason is the daily limit, nothing to do: the first provider is used again after it resets. If it is a setup problem (key, sender, blocked IP), fix it so the backup is not used up too.',
  },
  email_failing: {
    subject: 'LASUATOS emails are not being delivered',
    heading: 'Email delivery is failing',
    intro: 'Every email provider refused the last message. Students are not getting sign-up codes or password resets right now; they can still use Continue with Google where it is offered.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Read each provider’s reason below and on System health. Run pnpm prod:email:test --to you@example.com to test each provider. You may not get this alert by email while delivery is down; it is always on System health.',
  },
  email_quota: {
    subject: 'LASUATOS email allowance running out',
    heading: 'An email provider is nearly at its daily limit',
    intro: 'An email provider has used most of today’s free allowance. When it runs out, LASUATOS moves to the next provider by itself.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'If no backup provider is set up, add one (GMAIL_USER and GMAIL_APP_PASSWORD in Vercel, then redeploy) before the allowance runs out.',
  },
  error_rate: {
    subject: 'LASUATOS error rate is up',
    heading: 'Many requests are failing',
    intro: 'More requests than usual failed with a server error in the last few minutes. Individual errors are emailed separately.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Check Vercel → your project → Logs, and the database dashboard (Neon) for connection or quota limits.',
  },
  rate_limited: {
    subject: 'LASUATOS rate limits are being hit hard',
    heading: 'Many requests were refused as too fast',
    intro: 'A large number of requests were turned away by the rate limits in the last few minutes.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Often a guessing attempt, which the limits are there to stop. If real students are being refused (for example a whole hall at lecture start), the limit named below may need raising.',
  },
  sign_in_failures: {
    subject: 'LASUATOS sign-ins are failing',
    heading: 'Many sign-ins failed',
    intro: 'An unusual number of sign-ins failed with a wrong password in the last few minutes.',
    action: 'Open the sign-in page',
    path: '/sign-in',
    next: 'Try signing in yourself. If it works, someone is probably trying passwords and the sign-in limits are slowing them down.',
  },
  google_failing: {
    subject: 'LASUATOS Google sign-in checks are failing',
    heading: 'Google sign-ins are failing',
    intro: 'Several Google sign-ins could not be verified in the last few minutes. Students can still use emailed codes and passwords.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Check that GOOGLE_CLIENT_ID in Vercel is the client ID of the OAuth client whose redirect URI is this site’s /auth/google. A failure to fetch Google’s keys usually passes within minutes.',
  },
  backup_failed: {
    subject: 'LASUATOS backup failed',
    heading: 'A database backup failed',
    intro: 'The backup did not finish, so no new copy of the database was kept. The site itself is not affected, and earlier backups are still kept.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Open the run address above to see the step that failed. Fix it, then run the Database backup workflow again from GitHub → Actions. docs/BACKUPS.md lists what each step needs.',
  },
  backup_late: {
    subject: 'LASUATOS backups have stopped',
    heading: 'No database backup for more than a day',
    intro: 'LASUATOS has not heard of a good backup for over 30 hours. Until one runs, a mistake or a lost database could not be undone past Neon’s own 6-hour restore window.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'In GitHub → Actions → Database backup, check that the workflow is enabled and see the latest run. GitHub turns off scheduled workflows in public repositories after 60 days without a commit; enable it again there.',
  },
  origin_blocked: {
    subject: 'LASUATOS is blocking requests from another site',
    heading: 'Requests are being blocked as coming from another site',
    intro: 'Many requests that would change something were refused in the last few minutes because they did not come from the LASUATOS app’s own address.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Look at the origin below. If it is an address of this app (a new domain or a preview link), add it to TRUSTED_ORIGINS or set PUBLIC_APP_URL to it in Vercel and redeploy: nobody can sign in from it until then. If you do not know the site, the guard is stopping an attack and nothing needs doing.',
  },
  rate_limit_store: {
    subject: 'LASUATOS rate limits are off',
    heading: 'The rate limits are not counting',
    intro: 'The store that counts requests for the rate limits keeps failing. Sign-in and check-in still work, because the limits let requests through when they cannot count, but password guessing and floods are not being slowed down.',
    action: 'Open System health',
    path: '/admin/health',
    next: 'Check the database in Neon: is it up, suspended, or over its connection or compute allowance? The limits start counting again by themselves once it answers.',
  },
};

const ALERT_TONE: Partial<Record<OperatorAlertEmail['kind'], { tone: 'warning' | 'success'; label: string }>> = {
  schema_behind: { tone: 'warning', label: 'Action needed' },
  email_failover: { tone: 'warning', label: 'Handled automatically' },
  email_quota: { tone: 'warning', label: 'Heads-up' },
  rate_limited: { tone: 'warning', label: 'Heads-up' },
  sign_in_failures: { tone: 'warning', label: 'Heads-up' },
  backup_failed: { tone: 'warning', label: 'Action needed' },
  backup_late: { tone: 'warning', label: 'Action needed' },
  origin_blocked: { tone: 'warning', label: 'Heads-up' },
  rate_limit_store: { tone: 'warning', label: 'Action needed' },
};

export function operatorAlertMessage(email: OperatorAlertEmail, publicAppUrl: string): OutgoingMessage {
  const copy = ALERT_COPY[email.kind];
  return message(email.to, 'LASUATOS operator', `${copy.subject}: ${email.summary}`.slice(0, 160), {
    preheader: `${email.summary} · ${lagosWhen(email.occurredAt)}`,
    kicker: 'Site alert',
    heading: copy.heading,
    blocks: [
      { kind: 'status', tone: ALERT_TONE[email.kind]?.tone ?? 'danger', label: ALERT_TONE[email.kind]?.label ?? 'Error' },
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
      { kind: 'paragraph', muted: true, content: 'You get one email per problem at most every 30 minutes (page crashes and trends: hourly; a provider switch or a failed backup: every 6 hours; stopped backups: daily), and no more than 20 alerts a day. Every alert is also listed on System health.' },
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
