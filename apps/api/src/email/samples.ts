/**
 * One sample of every email LASUATOS can send, with realistic data. Used by
 * the message tests (every variant is checked) and by `pnpm email:preview`,
 * which writes them to HTML files for review.
 */
import {
  contactReceiptMessage,
  contactTeamMessage,
  appealDecidedMessage,
  appealSubmittedMessage,
  disputeResolvedMessage,
  disputeSubmittedMessage,
  operatorAlertMessage,
  passwordResetMessage,
  securityNoticeMessage,
  staffInvitationMessage,
  staffRoleChangedMessage,
  studentEmailCodeMessage,
  testMessage,
  verificationMessage,
  type OutgoingMessage,
} from './messages.js';

export interface EmailSample {
  readonly id: string;
  readonly group: 'Accounts' | 'Account security' | 'Attendance' | 'Contact' | 'Operations';
  readonly title: string;
  /** Security notices and codes: nothing in the email may be clickable. */
  readonly linkFree: boolean;
  readonly message: OutgoingMessage;
}

const TOKEN = 'Q2hvb3NlLWEtbmV3LXBhc3N3b3JkLXNhbXBsZS10b2tlbg';
const at = (iso: string) => new Date(iso);

export function emailSamples(publicAppUrl = 'https://lasuatos.vercel.app'): readonly EmailSample[] {
  const student = { to: 'chidinma.okeke@st.lasu.edu.ng', displayName: 'Chidinma Okeke' };
  return [
    { id: 'verify-email', group: 'Accounts', title: 'Confirm email address (link)', linkFree: false, message: verificationMessage({ ...student, token: TOKEN }, publicAppUrl) },
    ...(['open', 'open_jamb', 'move', 'face', 'reset', 'matric'] as const).map((purpose) => ({
      id: `code-${purpose.replace(/_/g, '-')}`,
      group: 'Accounts' as const,
      title: `Code: ${{ open: 'open an account', open_jamb: 'open an account (JAMB number)', move: 'move to a LASU email', face: 'new face photos', reset: 'reset password', matric: 'add the matric number' }[purpose]}`,
      linkFree: true,
      message: studentEmailCodeMessage({ ...student, code: '482913', expiresInMinutes: 15, purpose }, publicAppUrl),
    })),
    { id: 'password-reset', group: 'Accounts', title: 'Reset password (link)', linkFree: false, message: passwordResetMessage({ to: 'f.adeyemi@lasu.edu.ng', displayName: 'Dr. Folasade Adeyemi', token: TOKEN }, publicAppUrl) },
    {
      id: 'staff-invitation',
      group: 'Accounts',
      title: 'Staff invitation',
      linkFree: false,
      message: staffInvitationMessage({
        to: 'f.adeyemi@lasu.edu.ng',
        displayName: 'Dr. Folasade Adeyemi',
        token: TOKEN,
        roleLabel: 'Lecturer',
        scopeLabel: 'Electronic & Computer Engineering',
        institutionName: 'Lagos State University',
        invitedByName: 'Engr. Tunde Bakare',
        expiresAt: at('2026-11-17T13:05:00Z'),
      }, publicAppUrl),
    },
    {
      id: 'staff-role-changed',
      group: 'Accounts',
      title: 'Staff role changed',
      linkFree: true,
      message: staffRoleChangedMessage({
        to: 'f.adeyemi@lasu.edu.ng',
        displayName: 'Dr. Folasade Adeyemi',
        institutionName: 'Lagos State University',
        fromRoleLabel: 'Lecturer',
        fromScopeLabel: 'Electronic & Computer Engineering, Faculty of Engineering',
        toRoleLabel: 'Department administrator',
        toScopeLabel: 'Electronic & Computer Engineering, Faculty of Engineering',
        changedByName: 'Engr. Tunde Bakare',
        reason: 'Appointed acting HOD from 1 December.',
        coursesLeft: ['ECE 301', 'ECE 305'],
        occurredAt: at('2026-11-17T13:05:00Z'),
      }, publicAppUrl),
    },
    ...(['password_reset', 'password_changed', 'account_taken_over', 'account_released', 'matric_added'] as const).map((kind) => ({
      id: `notice-${kind.replace(/_/g, '-')}`,
      group: 'Account security' as const,
      title: { password_reset: 'Password was reset', password_changed: 'Password was changed', account_taken_over: 'Email removed from an account', account_released: 'Account released', matric_added: 'Matric number added' }[kind],
      linkFree: true,
      message: securityNoticeMessage({
        ...(kind.startsWith('account') ? { to: 'chidinma.okeke@gmail.com', displayName: 'LASUATOS user', matricNumber: '210591045' } : student),
        kind,
        occurredAt: at('2026-11-10T13:05:00Z'),
      }, publicAppUrl),
    })),
    {
      id: 'dispute-submitted',
      group: 'Attendance',
      title: 'Dispute submitted (to the lecturer)',
      linkFree: false,
      message: disputeSubmittedMessage({
        to: 'f.adeyemi@lasu.edu.ng',
        displayName: 'Dr. Folasade Adeyemi',
        courseCode: 'ECE 301',
        sessionTitle: 'Week 6 · Digital signal processing',
        sessionStartsAt: at('2026-11-09T09:00:00Z'),
        studentName: 'Ibrahim Yusuf',
        openDisputeCount: 3,
      }, publicAppUrl),
    },
    ...(['upheld', 'rejected'] as const).map((decision) => ({
      id: `dispute-${decision}`,
      group: 'Attendance' as const,
      title: decision === 'upheld' ? 'Dispute accepted (to the student)' : 'Dispute not accepted (to the student)',
      linkFree: false,
      message: disputeResolvedMessage({
        to: 'ibrahim.yusuf@st.lasu.edu.ng',
        displayName: 'Ibrahim Yusuf',
        courseCode: 'ECE 301',
        sessionTitle: 'Week 6 · Digital signal processing',
        sessionStartsAt: at('2026-11-09T09:00:00Z'),
        decision,
        note: decision === 'upheld'
          ? 'I remember you in the second row. Your phone could not reach the network in LT2; you are marked present.'
          : 'The lecture register and the venue check both show no attendance from you. Please see me during office hours if you have evidence.',
        lecturerName: 'Dr. Folasade Adeyemi',
      }, publicAppUrl),
    })),
    {
      id: 'appeal-submitted',
      group: 'Attendance',
      title: 'Dispute taken to the department (to its administrators)',
      linkFree: false,
      message: appealSubmittedMessage({
        to: 'hod.ece@lasu.edu.ng',
        displayName: 'Prof. Kunle Bakare',
        courseCode: 'ECE 301',
        sessionTitle: 'Week 6 · Digital signal processing',
        sessionStartsAt: at('2026-11-09T09:00:00Z'),
        studentName: 'Ibrahim Yusuf',
        departmentName: 'Electronic and Computer Engineering',
      }, publicAppUrl),
    },
    ...(['student', 'lecturer'] as const).flatMap((audience) => (['upheld', 'rejected'] as const).map((decision) => ({
      id: `appeal-${decision}-${audience}`,
      group: 'Attendance' as const,
      title: `Appeal ${decision === 'upheld' ? 'accepted' : 'not accepted'} (to the ${audience})`,
      linkFree: false,
      message: appealDecidedMessage({
        to: audience === 'student' ? 'ibrahim.yusuf@st.lasu.edu.ng' : 'f.adeyemi@lasu.edu.ng',
        displayName: audience === 'student' ? 'Ibrahim Yusuf' : 'Dr. Folasade Adeyemi',
        audience,
        courseCode: 'ECE 301',
        sessionTitle: 'Week 6 · Digital signal processing',
        sessionStartsAt: at('2026-11-09T09:00:00Z'),
        departmentName: 'Electronic and Computer Engineering',
        studentName: 'Ibrahim Yusuf',
        decision,
        note: decision === 'upheld'
          ? 'The venue check shows you inside LT2 at 9:04 and two classmates confirm it. Marked present.'
          : 'Nothing in the register or the venue check places you in the lecture, so the lecturer’s decision stands.',
        deciderName: 'Prof. Kunle Bakare',
      }, publicAppUrl),
    }))),
    {
      id: 'contact-team',
      group: 'Contact',
      title: 'New contact message (to administrators)',
      linkFree: false,
      message: contactTeamMessage({
        to: { email: 'admin@lasu.edu.ng', displayName: 'Engr. Tunde Bakare' },
        reference: 'LA-7KQ4RM',
        topicLabel: 'Bring LASUATOS to a department',
        senderName: 'Dr. Folasade Adeyemi',
        senderEmail: 'f.adeyemi@lasu.edu.ng',
        facts: [
          { label: 'Role', value: 'Lecturer' },
          { label: 'Department or unit', value: 'Department of Electronic and Computer Engineering' },
          { label: 'Students', value: 'About 420' },
        ],
        signedIn: true,
        message: 'We would like to use LASUATOS for all 300 level courses from the second semester.\n\nWho do we speak to about setting up the department, and is there a short guide we can share with class reps?',
        receivedAt: at('2026-11-10T09:12:00Z'),
      }, publicAppUrl),
    },
    {
      id: 'contact-receipt',
      group: 'Contact',
      title: 'Contact receipt (to the sender)',
      linkFree: false,
      message: contactReceiptMessage({ to: 'f.adeyemi@lasu.edu.ng', name: 'Dr. Folasade Adeyemi', reference: 'LA-7KQ4RM', topicLabel: 'Bring LASUATOS to a department' }, publicAppUrl),
    },
    ...(['server_error', 'page_error', 'schema_behind'] as const).map((kind) => ({
      id: `alert-${kind.replace(/_/g, '-')}`,
      group: 'Operations' as const,
      title: { server_error: 'Alert: server error', page_error: 'Alert: page crashed', schema_behind: 'Alert: database behind' }[kind],
      linkFree: false,
      message: operatorAlertMessage({
        to: 'ops@lasu.edu.ng',
        kind,
        summary: { server_error: 'POST /api/v1/lecture/check-in failed (TypeError)', page_error: '/sessions crashed (TypeError)', schema_behind: 'Database at 0023, release expects 0024' }[kind],
        details: kind === 'schema_behind'
          ? { applied: '0023_retention_runs', expected: '0024_contact_messages' }
          : { requestId: 'req-8f3k2a', route: kind === 'server_error' ? 'POST /api/v1/lecture/check-in' : '/sessions', error: "TypeError: Cannot read properties of undefined (reading 'id')" },
        fingerprint: kind,
        occurredAt: at('2026-11-10T13:05:00Z'),
      }, publicAppUrl),
    })),
    ...([
      ['email_failover', 'Alert: email provider switched', 'Brevo refused (daily limit); sent through Gmail', { refused: 'Brevo refused the message (HTTP 402): not_enough_credits. Fix: the daily sending limit was reached (300 emails/day on the free plan). It resets tomorrow.', 'paused until': 'Wed, 11 Nov 2026, 01:00 WAT', 'sent through': 'Gmail' }],
      ['email_failing', 'Alert: email delivery failing', 'every email provider refused the message', { Brevo: 'daily limit reached', Gmail: 'Gmail refused the message (EAUTH). Fix: Gmail refused the login.' }],
      ['email_quota', 'Alert: email allowance', 'Brevo has sent 270 of its 300 emails today', { 'takes over next': 'Gmail', resets: 'midnight UTC (01:00 Lagos time)' }],
      ['error_rate', 'Alert: error rate up', 'error rate up: 15 requests failed with a server error in 10 minutes', { 'last request': 'POST /api/v1/lecture/check-in' }],
      ['rate_limited', 'Alert: rate limits', 'rate limits hit hard: 60 requests refused as too fast in 10 minutes', { 'last request': 'POST /api/v1/auth/login' }],
    ] as const).map(([kind, title, summary, details]) => ({
      id: `alert-${kind.replace(/_/g, '-')}`,
      group: 'Operations' as const,
      title,
      linkFree: false,
      message: operatorAlertMessage({ to: 'ops@lasu.edu.ng', kind, summary, details, fingerprint: kind, occurredAt: at('2026-11-10T13:05:00Z') }, publicAppUrl),
    })),
    { id: 'email-test', group: 'Operations', title: 'Delivery test', linkFree: false, message: testMessage('admin@lasu.edu.ng', 'brevo', at('2026-11-10T13:05:00Z'), publicAppUrl) },
  ];
}
