/**
 * One sample of every email LASUATOS can send, with realistic data. Used by
 * the message tests (every variant is checked) and by `pnpm email:preview`,
 * which writes them to HTML files for review.
 */
import {
  contactReceiptMessage,
  contactTeamMessage,
  disputeResolvedMessage,
  disputeSubmittedMessage,
  operatorAlertMessage,
  passwordResetMessage,
  securityNoticeMessage,
  staffInvitationMessage,
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
    ...(['open', 'move', 'face', 'reset'] as const).map((purpose) => ({
      id: `code-${purpose}`,
      group: 'Accounts' as const,
      title: `Code: ${{ open: 'open an account', move: 'move to a LASU email', face: 'new face photos', reset: 'reset password' }[purpose]}`,
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
    ...(['password_reset', 'password_changed', 'account_taken_over', 'account_released'] as const).map((kind) => ({
      id: `notice-${kind.replace(/_/g, '-')}`,
      group: 'Account security' as const,
      title: { password_reset: 'Password was reset', password_changed: 'Password was changed', account_taken_over: 'Email removed from an account', account_released: 'Account released' }[kind],
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
    { id: 'email-test', group: 'Operations', title: 'Delivery test', linkFree: false, message: testMessage('admin@lasu.edu.ng', 'brevo', at('2026-11-10T13:05:00Z'), publicAppUrl) },
  ];
}
