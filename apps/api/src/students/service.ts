import { createHash, randomInt } from 'node:crypto';
import {
  academicSessionStartYear,
  academicSetLabel,
  checkMatricNumber,
  checkPersonName,
  checkStudentNumber,
  deriveStudentLevel,
  entryYearFromMatric,
  isJambRegNumber,
  isLasuStudentEmail,
  isPersonalEmail,
  isStudentProofEmail,
  jambYear,
  LASU_STUDENT_EMAIL_DOMAIN,
  studentNumberKind,
  studentNumberName,
  classListName,
  formatSetupCode,
  normalizeMatricNumber,
  normalizeStartingPassword,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  SETUP_CODE_TTL_MINUTES,
  startingPassword,
  tidyPersonName,
  type ClassList,
  type ClassListEntry,
  type ClassListEntryStage,
  type ClassListEntryUpdate,
  type ClassListImportProblem,
  type ClassListImportResult,
  type ClassListLookupResult,
  type FaceFrame,
  type FaceTurn,
  type GoogleProofPurpose,
  type GoogleSignInConfig,
  type AccountReleased,
  type SetupCodeIssued,
  type StudentMatricSwitched,
  type StudentSetup,
} from '@lasuatos/contracts';
import { createOpaqueToken, hashOpaqueToken, hashPassword } from '@lasuatos/auth';
import type { z } from 'zod';
import type { ClassListImportRequestSchema } from '@lasuatos/contracts';
import type { AuthenticatedAccount } from '../auth/repository.js';
import { SESSION_TTL_MILLISECONDS, type SecurityEventLogger } from '../auth/service.js';
import { GoogleProofError, type GoogleIdentity, type GoogleIdTokenVerifier } from '../auth/google-id-token.js';
import { emailFailureReason, type SecurityNoticeKind, type StudentEmailCodeSender } from '../email/transport.js';
import { FACE_FAILURE_LABELS } from './face-labels.js';
import { FACE_LIMITS, FaceCheckError, turnForTicket, type FaceVerifier } from './face.js';
import { admissionYear } from './postgres-repository.js';
import type { ClassListRecord, ClassListRowWrite, ProofMethod, StudentRepository } from './repository.js';

/** A failure whose message is written for the person in front of the screen. */
export class StudentError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'StudentError';
  }
}

export const EMAIL_CODE_TTL_SECONDS = 15 * 60;
export const EMAIL_CODE_COOLDOWN_SECONDS = 60;
export const EMAIL_CODE_DAILY_CAP = 8;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Failed face checks a student may have for one lecture in half an hour. */
export const FACE_FAILURES_PER_LECTURE = 6;
/** Failed face checks after which a student may ask the session taker to add them by hand. */
export const FACE_FAILURES_BEFORE_HELP = 2;
/** How long a confirmed request to take new face photos stays open. */
export const FACE_REPLACE_WINDOW_SECONDS = 20 * 60;
/** Replacements a student may make in FACE_REPLACE_PERIOD_DAYS (an administrator can always reset). */
export const FACE_REPLACEMENTS_PER_PERIOD = 2;
export const FACE_REPLACE_PERIOD_DAYS = 30;
/** Wrong guesses a HOC's setup code survives. */
export const SETUP_CODE_MAX_ATTEMPTS = 5;



const notOnList = (matric: string) => new StudentError(404, `${matric} is not on a class list yet. Ask your HOC to add you (they upload the class list in LASUATOS), then try again.${isJambRegNumber(matric) ? ' Students without a matric number yet are added with their JAMB registration number.' : ''}`);

/** "LASU email" or "email": what the student confirms, for messages about an entry. */
const emailWord = (entry: Pick<ClassListRecord, 'matricNumber'>) => (isJambRegNumber(entry.matricNumber) ? 'email' : 'LASU email');

type ImportInput = z.output<typeof ClassListImportRequestSchema>;

export interface OpenedAccount {
  readonly token: string;
  readonly userId: string;
  readonly startingPassword: string;
  /** An older, unconfirmed account was handed over rather than a new one opened. */
  readonly takenOver: boolean;
}

interface ListScope {
  readonly institutionId: string;
  readonly userId: string;
  readonly departmentIds: ReadonlySet<string> | null;
  readonly facultyIds: ReadonlySet<string> | null;
  readonly fixedEntryYear: number | null;
  readonly fixedDepartmentId: string | null;
  readonly canResetFaces: boolean;
  /** Administrators, HOCs and GHOCs; an assistant only when allowed. */
  readonly canGiveSetupCodes: boolean;
}

export interface StudentServiceOptions {
  readonly repository: StudentRepository;
  readonly institutionSlug: string;
  readonly emailSender?: StudentEmailCodeSender | undefined;
  /** Absent: faces are not checked (registration skips the camera, check-ins skip the face check). */
  readonly faces?: FaceVerifier | undefined;
  readonly now?: () => Date;
  readonly logger?: SecurityEventLogger;
  /** Checks a student's password (re-confirmation before taking new face photos). */
  readonly credentials?: { verifyStudent(identifier: string, password: string): Promise<string | null> } | undefined;
  /** "Continue with Google" in place of the emailed code (ADR 027). Absent: codes only. */
  readonly google?: GoogleSignIn | undefined;
}

export interface GoogleSignIn {
  readonly clientId: string;
  /** PUBLIC_APP_URL + /auth/google: registered with Google, the only place it returns to. */
  readonly redirectUri: string;
  readonly verifier: GoogleIdTokenVerifier;
}

/** The browser's proof from Google: the ID token and the raw nonce it was asked for with. */
export interface GoogleProofInput {
  readonly credential: string;
  readonly nonce: string;
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Whether Google's word is as good as a code to this address.
 * - A LASU student email: only from LASU's own Google Workspace (`hd`). A
 *   personal Google account can be registered on any address, so the
 *   address alone is not enough.
 * - A personal email (a student still on a JAMB number): only where Google
 *   itself runs the mailbox (Gmail, or a Workspace domain).
 */
export function googleProvesEmail(identity: GoogleIdentity, options: { readonly jamb: boolean }): boolean {
  if (isLasuStudentEmail(identity.email)) return identity.hostedDomain === LASU_STUDENT_EMAIL_DOMAIN;
  if (!options.jamb || !isPersonalEmail(identity.email)) return false;
  const domain = identity.email.slice(identity.email.lastIndexOf('@') + 1);
  return GMAIL_DOMAINS.has(domain) || identity.hostedDomain === domain;
}

/** What an emailed code is for. A code only works for the purpose it was sent for. */
type CodePurpose = 'open' | 'move' | 'face' | 'reset' | 'matric';

function codeHash(entryId: string, email: string, code: string, purpose: CodePurpose = 'open', matric = ''): string {
  // Opening, moving and face codes share the original format (codes already sent keep working);
  // a password-reset code is bound to its purpose, so no other code can reset a password, and a
  // matric-number code to the matric number it was asked for.
  const scope = purpose === 'reset' ? `reset:${email.toLowerCase()}`
    : purpose === 'matric' ? `matric:${matric}:${email.toLowerCase()}`
      : email.toLowerCase();
  return createHash('sha256').update(`${entryId}:${scope}:${code}`).digest('hex');
}

function setupCodeHash(entryId: string, code: string): string {
  return createHash('sha256').update(`setup:${entryId}:${code}`).digest('hex');
}

/** Eight characters from the look-alike-free alphabet, from a CSPRNG. */
function newSetupCode(): string {
  let code = '';
  for (let index = 0; index < SETUP_CODE_LENGTH; index += 1) code += SETUP_CODE_ALPHABET[randomInt(0, SETUP_CODE_ALPHABET.length)];
  return code;
}

const AUDIT_SUMMARIES: Record<string, string> = {
  class_list_imported: 'Uploaded the class list',
  class_list_entry_updated: 'Corrected a student',
  class_list_entry_removed: 'Removed a student',
  class_list_entry_moved: 'Moved a student here from another department',
  class_list_entry_moved_out: 'Moved a student to another department',
  account_opened: 'Opened their account',
  account_taken_over: 'Took over an older, unconfirmed account',
  account_released: 'Released a confirmed account for the student on the list',
  setup_code_issued: 'Gave a one-time setup code',
  password_reset_with_code: 'Reset a forgotten password',
  email_confirmed: 'Confirmed their LASU email',
  face_registered: 'Registered their face',
  face_reset: 'Reset a registered face',
  face_check_failed: 'Face check failed at check-in',
  face_duplicate_refused: 'Face matched another student; refused',
  face_replace_confirmed: 'Confirmed taking new face photos',
  face_replaced: 'Took new face photos',
  face_replace_refused: 'New face photos did not match; refused',
  face_review_approved: 'Approved a check-in photo',
  face_review_rejected: 'Rejected a check-in photo',
  help_request_created: 'Asked to be added by hand',
  help_request_added: 'Added after asking for help',
  help_request_declined: 'Help request declined',
  retention_run: 'Deleted face data after graduation',
};

export function studentAuditSummary(action: string): string {
  return AUDIT_SUMMARIES[action] ?? action.replace(/_/g, ' ');
}

export class StudentService {
  readonly #repository: StudentRepository;
  readonly #institutionSlug: string;
  readonly #emailSender: StudentEmailCodeSender | undefined;
  readonly #faces: FaceVerifier | undefined;
  readonly #now: () => Date;
  readonly #logger: SecurityEventLogger | undefined;
  readonly #credentials: StudentServiceOptions['credentials'];
  readonly #google: GoogleSignIn | undefined;
  #institutionId: string | null = null;

  constructor(options: StudentServiceOptions) {
    this.#repository = options.repository;
    this.#institutionSlug = options.institutionSlug;
    this.#emailSender = options.emailSender;
    this.#faces = options.faces;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
    this.#credentials = options.credentials;
    this.#google = options.google;
  }

  get faceRequired(): boolean {
    return this.#faces !== undefined;
  }

  /* ---------------- confirming with Google (ADR 027) ---------------- */

  /** Public: whether "Continue with Google" is on here, and where Google returns. */
  googleSignIn(): GoogleSignInConfig {
    return {
      clientId: this.#google?.clientId ?? null,
      redirectUri: this.#google?.redirectUri ?? null,
      hostedDomain: LASU_STUDENT_EMAIL_DOMAIN,
    };
  }

  /**
   * The address Google confirmed, once it is one Google can vouch for. Every
   * other rule (the listed address, addresses in use) is the caller's, the
   * same as for a code.
   */
  /** Checked first in every Google step, so a deployment without it answers the same way every time. */
  #requireGoogle(): GoogleSignIn {
    if (!this.#google) throw new StudentError(503, 'Continue with Google is not set up here. Use the emailed code.');
    return this.#google;
  }

  /**
   * Signing in with Google: the address Google vouches for (a LASU student
   * email from LASU's Workspace, a Gmail address, or a Workspace domain's
   * own address). Which account it opens is the sign-in service's call.
   */
  async googleSignInEmail(proof: GoogleProofInput): Promise<string> {
    return this.#googleEmail(proof, 'signin', { jamb: true, signIn: true });
  }

  async #googleEmail(proof: GoogleProofInput, purpose: GoogleProofPurpose, options: { readonly jamb: boolean; readonly signIn?: boolean }): Promise<string> {
    const google = this.#requireGoogle();
    let identity: GoogleIdentity;
    try {
      identity = await google.verifier.verify(proof.credential, proof.nonce, purpose);
    } catch (error) {
      if (!(error instanceof GoogleProofError)) throw error;
      this.#logger?.warn({ purpose, reason: error.reason }, 'A Google sign-in was refused');
      throw new StudentError(error.reason === 'keys_unavailable' ? 503 : 400, error.message);
    }
    if (!googleProvesEmail(identity, options)) {
      throw new StudentError(422, options.signIn && !isLasuStudentEmail(identity.email)
        ? `Google can’t vouch for ${identity.email}: it runs only LASU, Gmail and Google Workspace mailboxes. Sign in with your password instead.`
        : isLasuStudentEmail(identity.email)
        ? `${identity.email} is not an account in LASU’s Google. Sign in with the student account LASU gave you, or use the emailed code.`
        : options.jamb
          ? `Google can confirm a LASU student email or a Gmail address, not ${identity.email}. Pick one of those on Google’s page, or use the emailed code.`
          : `You picked ${identity.email}. Pick your LASU student account (…@${LASU_STUDENT_EMAIL_DOMAIN}) on Google’s page.`);
    }
    return identity.email;
  }

  async #institution(): Promise<string> {
    if (this.#institutionId) return this.#institutionId;
    const id = await this.#repository.findInstitutionId(this.#institutionSlug);
    if (!id) throw new StudentError(503, 'Student accounts are not set up yet.');
    this.#institutionId = id;
    return id;
  }

  #levelLabel(entry: Pick<ClassListRecord, 'matricNumber' | 'entryYear' | 'entryLevel' | 'programmeYears'>): string {
    return deriveStudentLevel({
      matricNumber: entry.matricNumber,
      entryYear: admissionYear(entry.entryYear, entry.entryLevel),
      entryLevel: entry.entryLevel,
      programmeYears: entry.programmeYears,
      sessionStartYear: academicSessionStartYear({ now: this.#now() }),
    }).label;
  }

  /** The number a student typed: their matric number, or their JAMB number while they have none. */
  #matric(raw: string): string {
    const number = checkStudentNumber(raw);
    if (!number.ok) {
      throw new StudentError(422, number.message.startsWith('Add')
        ? 'Enter your matric number: 9 digits, e.g. 250211184. No matric number yet? Enter your JAMB registration number.'
        : number.message);
    }
    return number.value;
  }

  /**
   * The entry for a number a student typed. A JAMB number also finds a
   * student whose matric number has since replaced it on the list, so a
   * Direct Entry student is never locked out by using the old number.
   */
  async #entryByNumber(institutionId: string, number: string): Promise<ClassListRecord | null> {
    const entry = await this.#repository.findEntryByMatric(institutionId, number);
    if (entry || !isJambRegNumber(number)) return entry;
    const [former] = await this.#repository.findEntriesByJamb(institutionId, [number]);
    return former ?? null;
  }

  /* ---------------- opening an account ---------------- */

  /** What the sign-up page shows after the student types their matric number (or JAMB number). */
  async lookup(rawMatric: string): Promise<ClassListLookupResult> {
    const matric = this.#matric(rawMatric);
    const entry = await this.#entryByNumber(await this.#institution(), matric);
    if (!entry) return { status: 'not_found', matricNumber: matric };
    if (entry.matricNumber !== matric) return { status: 'replaced', matricNumber: matric, replacedBy: entry.matricNumber };
    const accountStatus = await this.#accountStatus(entry);
    return {
      status: 'found',
      matricNumber: matric,
      numberKind: studentNumberKind(entry.matricNumber),
      fullName: classListName(entry),
      departmentName: entry.departmentName,
      levelLabel: this.#levelLabel(entry),
      hasAccount: accountStatus === 'open',
      accountStatus,
      emailOnList: entry.lasuEmail !== null,
    };
  }

  /**
   * An entry's account counts as open only once it has confirmed a LASU
   * student email. An older account (opened before class lists, or never
   * confirmed) is 'unconfirmed': the student who confirms the LASU email, or
   * brings a setup code from the HOC, takes it over.
   */
  async #accountStatus(entry: ClassListRecord): Promise<'none' | 'open' | 'unconfirmed'> {
    if (entry.studentUserId) return entry.accountEmailVerified ? 'open' : 'unconfirmed';
    return (await this.#olderAccount(entry)) ? 'unconfirmed' : 'none';
  }

  /** An account using the entry's matric number that is not linked to the entry (yet). */
  async #olderAccount(entry: ClassListRecord): Promise<string | null> {
    if (entry.studentUserId) return entry.studentUserId;
    return this.#repository.findStudentUserByMatric(entry.institutionId, entry.matricNumber);
  }

  #alreadyOpen(entry: ClassListRecord): StudentError {
    const word = emailWord(entry);
    return new StudentError(409, `An account is already open for ${entry.matricNumber}, with a confirmed ${word}. Sign in with your ${studentNumberName(entry.matricNumber)}. Forgot the password? Reset it with a code sent to ${entry.accountEmail ?? `your ${word}`}.`);
  }

  async #sendCode(entry: ClassListRecord, email: string, purpose: CodePurpose, matric = ''): Promise<{ email: string; resendInSeconds: number }> {
    if (!this.#emailSender) throw new StudentError(503, 'Email is not set up, so codes cannot be sent right now. Tell your HOC.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = this.#now();
    const issued = await this.#repository.issueEmailCode({
      entryId: entry.id,
      email,
      codeHash: codeHash(entry.id, email, code, purpose, matric),
      now,
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_SECONDS * 1000),
      cooldownSeconds: EMAIL_CODE_COOLDOWN_SECONDS,
      dailyCap: EMAIL_CODE_DAILY_CAP,
    });
    if (issued.kind === 'cooldown') {
      throw new StudentError(429, `A code was sent a moment ago. Check your ${isLasuStudentEmail(email) ? 'LASU ' : ''}inbox (and Spam), or ask for a new one in ${issued.retryAfterSeconds} seconds.`);
    }
    if (issued.kind === 'daily_cap') {
      throw new StudentError(429, `Too many codes have been sent for this ${studentNumberName(entry.matricNumber)} today. Try again tomorrow, or ask your HOC for help.`);
    }
    try {
      await this.#emailSender.sendStudentEmailCode({
        to: email,
        displayName: entry.firstName,
        code,
        expiresInMinutes: EMAIL_CODE_TTL_SECONDS / 60,
        // A student on a JAMB number opens with a personal email: the message says so.
        purpose: purpose === 'open' && isJambRegNumber(entry.matricNumber) && !isLasuStudentEmail(email) ? 'open_jamb' : purpose,
      });
    } catch (error) {
      this.#logger?.warn({ reason: emailFailureReason(error) }, 'Student email code could not be delivered');
      throw new StudentError(502, 'The code could not be sent just now. Try again in a minute.');
    }
    return { email, resendInSeconds: EMAIL_CODE_COOLDOWN_SECONDS };
  }

  /**
   * Tells an address about a change to the account after it happened. Never
   * fails the request: the change is done, and the audit log has it.
   */
  async #notify(to: string, displayName: string, kind: SecurityNoticeKind, matricNumber: string): Promise<void> {
    if (!this.#emailSender?.sendSecurityNotice || to.endsWith('.invalid')) return;
    try {
      await this.#emailSender.sendSecurityNotice({ to, displayName, kind, occurredAt: this.#now(), matricNumber });
    } catch (error) {
      this.#logger?.warn({ kind, reason: emailFailureReason(error) }, 'Student security notice could not be delivered');
    }
  }

  /**
   * Which address a code goes to: the one on the class list when the HOC
   * supplied it (typing a different one is refused), otherwise the one the
   * student types. A LASU student email, except for a student on the list by
   * JAMB number: they have none yet, so their personal email stands in.
   */
  async #codeAddress(entry: ClassListRecord, typed: string | undefined, exceptUserId: string | null, via: ProofMethod = 'code'): Promise<string> {
    const jamb = isJambRegNumber(entry.matricNumber);
    const word = jamb ? 'email' : 'LASU email';
    // A personal email listed while on the JAMB number does not carry over once the matric number is in.
    const listedRaw = entry.lasuEmail?.toLowerCase() ?? null;
    const listed = listedRaw && isStudentProofEmail(listedRaw, { jamb }) ? listedRaw : null;
    if (listed && typed && typed.toLowerCase() !== listed) {
      throw new StudentError(422, via === 'google'
        ? `You signed in to Google as ${typed.toLowerCase()}, but your class list has ${listed} for you. Pick that account on Google’s page, or ask your HOC to correct the list.`
        : `Your class list has a different ${word} for you (${listed}). Use that one, or ask your HOC to correct it.`);
    }
    const email = (listed ?? typed)?.toLowerCase();
    if (!email) {
      throw new StudentError(422, jamb
        ? 'Enter an email address you can open now (e.g. your Gmail). You are on the class list by JAMB number, so your personal email stands in until you get your LASU email.'
        : 'Enter your LASU student email (…@st.lasu.edu.ng).');
    }
    if (!isStudentProofEmail(email, { jamb })) {
      throw new StudentError(422, jamb
        ? 'Enter a full email address you can open now, e.g. name@gmail.com.'
        : 'Use your LASU student email (…@st.lasu.edu.ng). No LASU email yet? Ask your HOC for a setup code.');
    }
    if (await this.#repository.emailInUse(entry.institutionId, email, { exceptUserId, exceptEntryId: entry.id })) {
      throw new StudentError(409, `That ${word} is already used by another student. Check it, or ask your HOC for help.`);
    }
    return email;
  }

  async requestOpeningCode(input: { readonly matricNumber: string; readonly email?: string | undefined }) {
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#entryByNumber(await this.#institution(), matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId && entry.accountEmailVerified) throw this.#alreadyOpen(entry);
    // An older, unconfirmed account may already use this address: it is the one being taken over.
    const email = await this.#codeAddress(entry, input.email, await this.#olderAccount(entry));
    const sent = await this.#sendCode(entry, email, 'open');
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  async #checkCode(entryId: string, code: string, purpose: CodePurpose = 'open'): Promise<string> {
    const result = await this.#repository.checkEmailCode({
      entryId,
      hashFor: (email) => codeHash(entryId, email, code, purpose),
      now: this.#now(),
      maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
    });
    if (result.kind === 'ok') return result.email;
    if (result.kind === 'wrong') {
      throw new StudentError(400, result.attemptsLeft > 0
        ? `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That code is not right, and it can no longer be used. Ask for a new code.');
    }
    if (result.kind === 'expired') throw new StudentError(400, 'That code has expired. Ask for a new one.');
    throw new StudentError(400, 'Ask for a code first (or a new one: the last one was used up).');
  }

  /**
   * Opens the account once the emailed code is right. The password is the
   * LASU-style starting password, which the student can change later. An
   * older account with this matric number whose LASU email was never
   * confirmed is taken over instead (its attendance is kept).
   */
  async openAccount(input: { readonly matricNumber: string; readonly code: string }): Promise<OpenedAccount> {
    const institutionId = await this.#institution();
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#entryByNumber(institutionId, matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId && entry.accountEmailVerified) throw this.#alreadyOpen(entry);
    const email = await this.#checkCode(entry.id, input.code);
    return this.#open(entry, email, { emailVerified: true, vouchedByUserId: null });
  }

  /**
   * Opens the account (or takes over an older, unconfirmed one) with a
   * one-time setup code from the HOC, for a student who cannot get the
   * emailed code. The LASU email is recorded but not confirmed: the student
   * confirms it from their account when they can, and until then whoever
   * confirms that LASU email can still take the account over.
   */
  async openWithSetupCode(input: { readonly matricNumber: string; readonly setupCode: string; readonly email?: string | undefined }): Promise<OpenedAccount> {
    const institutionId = await this.#institution();
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#entryByNumber(institutionId, matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId && entry.accountEmailVerified) throw this.#alreadyOpen(entry);
    // Checked before the code is spent, so a typo in the email does not waste it.
    const email = await this.#codeAddress(entry, input.email, await this.#olderAccount(entry));
    const used = await this.#repository.useSetupCode({
      entryId: entry.id,
      codeHash: setupCodeHash(entry.id, input.setupCode),
      now: this.#now(),
      maxAttempts: SETUP_CODE_MAX_ATTEMPTS,
    });
    if (used.kind === 'wrong') {
      throw new StudentError(400, used.attemptsLeft > 0
        ? `That setup code is not right. ${used.attemptsLeft} ${used.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That setup code is not right, and it can no longer be used. Ask your HOC for a new one.');
    }
    if (used.kind === 'expired') throw new StudentError(400, `That setup code has expired (they work for ${SETUP_CODE_TTL_MINUTES} minutes). Ask your HOC for a new one.`);
    if (used.kind === 'missing') throw new StudentError(400, 'There is no setup code for this matric number (or it was already used). Ask your HOC to give you one.');
    return this.#open(entry, email, { emailVerified: false, vouchedByUserId: used.issuedByUserId });
  }

  /**
   * Opens the account with Google in place of the emailed code: Google
   * confirms the student owns the address, so no email is sent at all.
   */
  async openAccountWithGoogle(input: { readonly matricNumber: string; readonly google: GoogleProofInput }): Promise<OpenedAccount> {
    this.#requireGoogle();
    const institutionId = await this.#institution();
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#entryByNumber(institutionId, matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId && entry.accountEmailVerified) throw this.#alreadyOpen(entry);
    const confirmed = await this.#googleEmail(input.google, 'open', { jamb: isJambRegNumber(entry.matricNumber) });
    const email = await this.#codeAddress(entry, confirmed, await this.#olderAccount(entry), 'google');
    return this.#open(entry, email, { emailVerified: true, vouchedByUserId: null, via: 'google' });
  }

  async #open(entry: ClassListRecord, email: string, how: { readonly emailVerified: boolean; readonly vouchedByUserId: string | null; readonly via?: ProofMethod }): Promise<OpenedAccount> {
    const password = startingPassword(entry.matricNumber, entry.surname);
    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.openAccount({
      entryId: entry.id,
      institutionId: entry.institutionId,
      email,
      emailVerified: how.emailVerified,
      passwordHash: await hashPassword(password),
      sessionTokenHash: hashOpaqueToken(token),
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
      now,
      vouchedByUserId: how.vouchedByUserId,
      jamb: isJambRegNumber(entry.matricNumber),
      via: how.via,
    });
    const word = emailWord(entry);
    const numberWord = studentNumberName(entry.matricNumber);
    if (result.kind === 'claimed') throw new StudentError(409, `An account is already open for this ${numberWord}, with a confirmed ${word}. Sign in instead.`);
    if (result.kind === 'email_taken') throw new StudentError(409, `That ${word} is already used by another account. Ask your HOC for help.`);
    if (result.kind === 'matric_taken') throw new StudentError(409, `Another account with a confirmed ${word} already uses this ${numberWord}. Sign in with it, or ask your HOC for help.`);
    if (result.kind === 'taken_over') {
      this.#logger?.warn({ matricNumber: entry.matricNumber }, 'An older, unconfirmed student account was taken over by the listed student');
      // Whoever used it before is told, at the address they gave (never confirmed, so it may not reach anyone).
      if (result.previousEmail !== email.toLowerCase()) await this.#notify(result.previousEmail, 'LASUATOS user', 'account_taken_over', entry.matricNumber);
    }
    return { token, userId: result.userId, startingPassword: password, takenOver: result.kind === 'taken_over' };
  }

  /* ---------------- forgot password, with a code (students) ---------------- */

  /** The entry of an open account (confirmed LASU email), for resetting its password. */
  async #openEntry(rawMatric: string): Promise<ClassListRecord & { studentUserId: string; accountEmail: string }> {
    const matric = this.#matric(rawMatric);
    const entry = await this.#entryByNumber(await this.#institution(), matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId && entry.accountEmailVerified && entry.accountEmail) {
      return { ...entry, studentUserId: entry.studentUserId, accountEmail: entry.accountEmail };
    }
    if (await this.#olderAccount(entry)) {
      throw new StudentError(409, `The account for ${matric} has no confirmed ${emailWord(entry)}, so a code cannot be sent to it. Open your account again with a code to your ${emailWord(entry)}: it moves the older account to you and keeps its attendance.`);
    }
    throw new StudentError(409, `No account is open for ${matric} yet. Open your account first: it takes two minutes.`);
  }

  /** Sends a 6-digit code to the account's confirmed LASU email to choose a new password. */
  async requestPasswordCode(input: { readonly matricNumber: string }) {
    const entry = await this.#openEntry(input.matricNumber);
    const sent = await this.#sendCode(entry, entry.accountEmail, 'reset');
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  /**
   * Sets the new password once the emailed code is right. Every device is
   * signed out and this one is signed in.
   */
  async resetPasswordWithCode(input: { readonly matricNumber: string; readonly code: string; readonly password: string }): Promise<{ token: string; userId: string; signedOutSessions: number }> {
    const entry = await this.#openEntry(input.matricNumber);
    // Checked before the code is spent: the starting password can be guessed from the class list
    // (a Direct Entry student's JAMB number is on it too).
    this.#refuseGuessable(entry, input.password);
    await this.#checkCode(entry.id, input.code, 'reset');
    return this.#setNewPassword(entry, input.password, 'code');
  }

  /**
   * Forgot password with Google: Google confirms the account's own email
   * (no code is sent), then the new password is set the same way.
   */
  async resetPasswordWithGoogle(input: { readonly matricNumber: string; readonly google: GoogleProofInput; readonly password: string }): Promise<{ token: string; userId: string; signedOutSessions: number }> {
    this.#requireGoogle();
    const entry = await this.#openEntry(input.matricNumber);
    this.#refuseGuessable(entry, input.password);
    const confirmed = await this.#googleEmail(input.google, 'reset', { jamb: isJambRegNumber(entry.matricNumber) || !isLasuStudentEmail(entry.accountEmail) });
    if (confirmed !== entry.accountEmail.toLowerCase()) {
      throw new StudentError(400, `You signed in to Google as ${confirmed}, but this account uses ${entry.accountEmail}. Pick that account on Google’s page.`);
    }
    return this.#setNewPassword(entry, input.password, 'google');
  }

  #refuseGuessable(entry: ClassListRecord, password: string): void {
    const typed = normalizeStartingPassword(password);
    if ([entry.matricNumber, entry.jambNumber].some((number) => number && typed === startingPassword(number, entry.surname))) {
      throw new StudentError(422, 'Choose a new password, not the starting one (LASU + matric or JAMB number + SURNAME): anyone who knows your number could guess it.');
    }
  }

  async #setNewPassword(entry: ClassListRecord & { studentUserId: string; accountEmail: string }, password: string, via: ProofMethod): Promise<{ token: string; userId: string; signedOutSessions: number }> {
    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.resetPasswordWithCode({
      userId: entry.studentUserId,
      institutionId: entry.institutionId,
      matricNumber: entry.matricNumber,
      passwordHash: await hashPassword(password),
      sessionTokenHash: hashOpaqueToken(token),
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
      now,
      via,
    });
    if (result.kind === 'missing') throw new StudentError(409, 'This account is not active. Ask your HOC or an administrator for help.');
    await this.#notify(entry.accountEmail, entry.firstName, 'password_reset', entry.matricNumber);
    return { token, userId: entry.studentUserId, signedOutSessions: result.signedOutSessions };
  }

  /* ---------------- setup of a signed-in student ---------------- */

  async #studentAccount(account: AuthenticatedAccount) {
    if (account.accountType !== 'student') throw new StudentError(403, 'Only student accounts have this.');
    const student = await this.#repository.findStudentAccount(account.id);
    if (!student) throw new StudentError(401, 'Sign in to continue.');
    return student;
  }

  /** The entry for a signed-in student: linked to the account, or matched by matric number. */
  async #entryFor(student: { userId: string; institutionId: string; matricNumber: string }): Promise<ClassListRecord | null> {
    const linked = await this.#repository.findEntryByUser(student.userId);
    if (linked) return linked;
    const byMatric = await this.#repository.findEntryByMatric(student.institutionId, normalizeMatricNumber(student.matricNumber));
    return byMatric && !byMatric.studentUserId ? byMatric : null;
  }

  async setup(account: AuthenticatedAccount): Promise<StudentSetup> {
    const student = await this.#studentAccount(account);
    const entry = await this.#entryFor(student);
    const linked = entry?.studentUserId === student.userId;
    // Proof of who they are: a confirmed LASU email, or the personal one of a student who joined on a JAMB number.
    const emailVerified = linked && student.emailVerified && isStudentProofEmail(student.email, { jamb: Boolean(entry?.jambJoined) });
    const face = await this.#repository.findFaceProfile(student.userId);
    const faceRegistered = face !== null;
    const replaceUntil = face?.replaceAllowedUntil && face.replaceAllowedUntil > this.#now() ? face.replaceAllowedUntil : null;
    return {
      classList: entry ? {
        surname: entry.surname,
        firstName: entry.firstName,
        middleName: entry.middleName,
        departmentName: entry.departmentName,
        facultyName: entry.facultyName,
        levelLabel: this.#levelLabel(entry),
        setLabel: academicSetLabel(entry.entryYear),
        listedEmail: entry.lasuEmail,
      } : null,
      numberKind: studentNumberKind(entry?.matricNumber ?? student.matricNumber),
      studentNumber: entry?.matricNumber ?? normalizeMatricNumber(student.matricNumber),
      jambNumber: entry?.jambNumber ?? null,
      emailKind: emailVerified ? (isLasuStudentEmail(student.email) ? 'lasu' : 'personal') : null,
      emailVerified,
      lasuEmail: emailVerified ? student.email : null,
      vouched: linked && !emailVerified && entry.accountVouched,
      faceRequired: this.faceRequired,
      faceRegistered,
      defaultPassword: student.passwordIsDefault,
      faceEnrolledAt: face ? face.enrolledAt.toISOString() : null,
      faceReplaceAllowedUntil: replaceUntil ? replaceUntil.toISOString() : null,
      complete: Boolean(entry) && emailVerified && (faceRegistered || !this.faceRequired),
    };
  }

  async requestAccountEmailCode(account: AuthenticatedAccount, typed: string | undefined) {
    const student = await this.#studentAccount(account);
    const entry = await this.#entryFor(student);
    if (!entry) throw notOnList(normalizeMatricNumber(student.matricNumber));
    const email = await this.#codeAddress(entry, typed, student.userId);
    const sent = await this.#sendCode(entry, email, 'move');
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  async verifyAccountEmail(account: AuthenticatedAccount, code: string): Promise<{ status: 'verified'; email: string }> {
    const student = await this.#studentAccount(account);
    const entry = await this.#entryFor(student);
    if (!entry) throw notOnList(normalizeMatricNumber(student.matricNumber));
    const email = await this.#checkCode(entry.id, code);
    const result = await this.#repository.confirmAccountEmail({ userId: student.userId, entryId: entry.id, email, now: this.#now() });
    if (result === 'claimed') throw new StudentError(409, `Another account has already been opened for this ${studentNumberName(entry.matricNumber)}. Ask your HOC for help.`);
    if (result === 'email_taken') throw new StudentError(409, `That ${emailWord(entry)} is already used by another account. Ask your HOC for help.`);
    return { status: 'verified', email };
  }

  /** Confirms the account's email with Google in place of a code (e.g. after opening with a HOC's setup code). */
  async verifyAccountEmailWithGoogle(account: AuthenticatedAccount, google: GoogleProofInput): Promise<{ status: 'verified'; email: string }> {
    this.#requireGoogle();
    const student = await this.#studentAccount(account);
    const entry = await this.#entryFor(student);
    if (!entry) throw notOnList(normalizeMatricNumber(student.matricNumber));
    const confirmed = await this.#googleEmail(google, 'email', { jamb: isJambRegNumber(entry.matricNumber) });
    const email = await this.#codeAddress(entry, confirmed, student.userId, 'google');
    const result = await this.#repository.confirmAccountEmail({ userId: student.userId, entryId: entry.id, email, now: this.#now(), via: 'google' });
    if (result === 'claimed') throw new StudentError(409, `Another account has already been opened for this ${studentNumberName(entry.matricNumber)}. Ask your HOC for help.`);
    if (result === 'email_taken') throw new StudentError(409, `That ${emailWord(entry)} is already used by another account. Ask your HOC for help.`);
    return { status: 'verified', email };
  }

  /* ---------------- a JAMB-number student adds their matric number ---------------- */

  /**
   * Checks that a student on the list by JAMB number may take this matric
   * number and LASU email. The matric number must be free, or on an entry the
   * HOC added for it on the student's own list that no account uses (it is
   * folded in); an entry with a listed LASU email must match the one typed.
   */
  async #matricSwitch(account: AuthenticatedAccount, matricNumber: string, rawEmail: string): Promise<{ entry: ClassListRecord; email: string; mergeEntryId: string | null }> {
    const student = await this.#studentAccount(account);
    const entry = await this.#repository.findEntryByUser(student.userId);
    if (!entry) throw notOnList(normalizeMatricNumber(student.matricNumber));
    if (!isJambRegNumber(entry.matricNumber)) {
      throw new StudentError(409, `Your matric number (${entry.matricNumber}) is already on the class list. To correct it, ask your HOC.`);
    }
    const matric = checkMatricNumber(matricNumber);
    if (!matric.ok) throw new StudentError(422, matric.message);
    const email = rawEmail.trim().toLowerCase();
    if (!isLasuStudentEmail(email)) throw new StudentError(422, 'Use your LASU student email (…@st.lasu.edu.ng).');
    const matricYear = entryYearFromMatric(matric.value, entry.entryYear + 2);
    const admitted = admissionYear(entry.entryYear, entry.entryLevel);
    if (matricYear !== null && (matricYear < admitted - 1 || matricYear > admitted + 1)) {
      throw new StudentError(422, `${matric.value} starts with ${String(matricYear).slice(2)}, but you were admitted in ${admitted}. Check the number on your admission letter or portal, or ask your HOC.`);
    }
    let mergeEntryId: string | null = null;
    const holder = await this.#entryByNumber(student.institutionId, matric.value);
    if (holder && holder.id !== entry.id) {
      if (holder.studentUserId || holder.departmentId !== entry.departmentId || holder.entryYear !== entry.entryYear) {
        throw new StudentError(409, `${matric.value} is already on ${holder.studentUserId ? 'another student’s account' : `the ${holder.departmentName} list (${academicSetLabel(holder.entryYear)})`}. If it is yours, ask your HOC to sort it out.`);
      }
      // Folding in the HOC's row needs the same name: no one takes a classmate's matric number.
      const sameName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' }) === 0;
      if (!sameName(holder.surname, entry.surname) || !sameName(holder.firstName, entry.firstName)) {
        throw new StudentError(409, `${matric.value} is on your class list for another student (${holder.firstName} ${holder.surname}). Check the number, or ask your HOC.`);
      }
      if (holder.lasuEmail && holder.lasuEmail.toLowerCase() !== email) {
        throw new StudentError(422, `Your class list has a different LASU email for ${matric.value}. Use that one, or ask your HOC to correct it.`);
      }
      mergeEntryId = holder.id;
    }
    const older = await this.#repository.findStudentUserByMatric(student.institutionId, matric.value);
    if (older && older !== student.userId) throw new StudentError(409, `Another account already uses ${matric.value}. If it is yours, ask your HOC or an administrator.`);
    if (await this.#repository.emailInUse(student.institutionId, email, { exceptUserId: student.userId, exceptEntryId: mergeEntryId ?? entry.id })) {
      throw new StudentError(409, 'That LASU email is already used by another student. Check it, or ask your HOC for help.');
    }
    return { entry, email, mergeEntryId };
  }

  /** Step 1: a code to the LASU email, bound to the matric number asked for. */
  async requestMatricCode(account: AuthenticatedAccount, input: { readonly matricNumber: string; readonly email: string }) {
    const { entry, email } = await this.#matricSwitch(account, input.matricNumber, input.email);
    const matric = normalizeMatricNumber(input.matricNumber);
    const sent = await this.#sendCode(entry, email, 'matric', matric);
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  /**
   * Step 2: the code switches the student to the matric number. The account,
   * attendance, courses and face stay; registers show the matric number, the
   * LASU email becomes the sign-in email, and the JAMB number still signs in.
   */
  async confirmMatric(account: AuthenticatedAccount, input: { readonly matricNumber: string; readonly email: string; readonly code: string }): Promise<StudentMatricSwitched> {
    const { entry, email, mergeEntryId } = await this.#matricSwitch(account, input.matricNumber, input.email);
    const matric = normalizeMatricNumber(input.matricNumber);
    const result = await this.#repository.checkEmailCode({
      entryId: entry.id,
      hashFor: (address) => codeHash(entry.id, address, input.code, 'matric', matric),
      now: this.#now(),
      maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
    });
    if (result.kind === 'wrong') {
      throw new StudentError(400, result.attemptsLeft > 0
        ? `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That code is not right, and it can no longer be used. Ask for a new code.');
    }
    if (result.kind === 'expired') throw new StudentError(400, 'That code has expired. Ask for a new one.');
    if (result.kind !== 'ok') throw new StudentError(400, 'Ask for a code first (or a new one: the last one was used up).');
    if (result.email.toLowerCase() !== email) throw new StudentError(400, 'That code was sent to a different email. Ask for a new one.');
    return this.#switchToMatric(entry, matric, email, mergeEntryId, 'code');
  }

  /**
   * The same switch with Google confirming the LASU email: the student picks
   * their LASU account on Google's page instead of typing it and waiting for
   * a code.
   */
  async confirmMatricWithGoogle(account: AuthenticatedAccount, input: { readonly matricNumber: string; readonly google: GoogleProofInput }): Promise<StudentMatricSwitched> {
    // Only a LASU student email can come with a matric number (jamb: false refuses personal ones).
    const confirmed = await this.#googleEmail(input.google, 'matric', { jamb: false });
    const { entry, email, mergeEntryId } = await this.#matricSwitch(account, input.matricNumber, confirmed);
    return this.#switchToMatric(entry, normalizeMatricNumber(input.matricNumber), email, mergeEntryId, 'google');
  }

  async #switchToMatric(entry: ClassListRecord, matric: string, email: string, mergeEntryId: string | null, via: ProofMethod): Promise<StudentMatricSwitched> {
    const switched = await this.#repository.switchToMatric({
      entryId: entry.id,
      institutionId: entry.institutionId,
      userId: entry.studentUserId!,
      matricNumber: matric,
      email,
      mergeEntryId,
      now: this.#now(),
      via,
    });
    if (switched.kind === 'changed') throw new StudentError(409, 'Your class list entry changed meanwhile (your HOC may have added your matric number). Reload the page.');
    if (switched.kind === 'matric_taken') throw new StudentError(409, `${matric} is already used by another student. If it is yours, ask your HOC.`);
    if (switched.kind !== 'switched') throw new StudentError(409, 'That LASU email is already used by another account. Ask your HOC for help.');
    // The old address is told, in case it was not them.
    if (entry.accountEmail && entry.accountEmail !== email) await this.#notify(entry.accountEmail, entry.firstName, 'matric_added', matric);
    return { status: 'switched', matricNumber: matric, previousNumber: entry.matricNumber, email, attendanceMoved: switched.attendanceMoved };
  }

  /** Registers the signed-in student's face (once; an administrator can reset it). */
  /**
   * Wakes the face engine while the student is still in front of the camera
   * (the face camera calls this as it opens), so the photos that follow are
   * checked without a cold start. The route asks for any signed-in account:
   * a check-in can run on a classmate's phone.
   */
  async warmFaceChecks(): Promise<{ status: 'ready' | 'off' | 'unavailable' }> {
    if (!this.#faces) return { status: 'off' };
    return { status: (await this.#faces.warm()) ? 'ready' : 'unavailable' };
  }

  async enrolFace(account: AuthenticatedAccount, frames: readonly FaceFrame[]): Promise<{ status: 'registered'; enrolledAt: string }> {
    if (!this.#faces) throw new StudentError(503, 'Face registration is not switched on.');
    const student = await this.#studentAccount(account);
    const setup = await this.setup(account);
    if (!setup.classList) throw notOnList(normalizeMatricNumber(student.matricNumber));
    // Opened with the HOC's setup code: the HOC vouched for them, so the face can come before the email.
    if (!setup.emailVerified && !setup.vouched) throw new StudentError(409, 'Confirm your LASU email first.');
    if (setup.faceRegistered) throw new StudentError(409, 'Your face is already registered. To take new photos, use “Take new photos” on your account page.');
    const enrolment = await this.#faces.enrol(frames);
    const others = await this.#repository.listFaceCentroids(student.institutionId, student.userId);
    const duplicate = this.#faces.duplicateOf(enrolment.centroid, others);
    if (duplicate) {
      await this.#repository.audit({
        institutionId: student.institutionId,
        actorUserId: null,
        action: 'face_duplicate_refused',
        subjectUserId: student.userId,
        matricNumber: normalizeMatricNumber(student.matricNumber),
        details: `score=${duplicate.score.toFixed(3)} other_user=${duplicate.match.userId}`,
      });
      throw new StudentError(409, 'This face is already registered to another student’s account. If that is a mistake, ask your HOC or an administrator.');
    }
    const now = this.#now();
    const saved = await this.#repository.saveFaceProfile({
      userId: student.userId,
      institutionId: student.institutionId,
      model: enrolment.model,
      templates: enrolment.templates,
      centroid: enrolment.centroid,
      photo: enrolment.photo,
      quality: enrolment.quality,
      consentedAt: now,
      now,
    });
    if (saved === 'exists') throw new StudentError(409, 'Your face is already registered.');
    await this.#repository.audit({
      institutionId: student.institutionId,
      actorUserId: null,
      action: 'face_registered',
      subjectUserId: student.userId,
      matricNumber: normalizeMatricNumber(student.matricNumber),
      details: `model=${enrolment.model} live=${enrolment.quality.live} real=${enrolment.quality.real}`,
    });
    return { status: 'registered', enrolledAt: now.toISOString() };
  }

  /* ---------------- taking new face photos (the student themself) ---------------- */

  /**
   * Step 1 of replacing a registered face: the current password, then a code
   * to the confirmed LASU address. Both are needed, so a borrowed phone that
   * is still signed in is not enough to swap the face on an account.
   */
  async requestFaceReplaceCode(account: AuthenticatedAccount, password: string) {
    if (!this.#faces) throw new StudentError(503, 'Face registration is not switched on.');
    const student = await this.#studentAccount(account);
    const setup = await this.setup(account);
    if (!setup.faceRegistered) throw new StudentError(409, 'No face is registered on this account yet. Register it from your account setup.');
    if (!setup.emailVerified || !setup.lasuEmail) throw new StudentError(409, 'Confirm your LASU email first.');
    if (!this.#credentials) throw new StudentError(503, 'Password checks are not available right now. Try again later.');
    const verifiedUser = await this.#credentials.verifyStudent(student.email, password);
    if (verifiedUser !== student.userId) throw new StudentError(400, 'That password is not right.');
    await this.#replacementAllowance(student.userId);
    const entry = await this.#entryFor(student);
    if (!entry) throw notOnList(normalizeMatricNumber(student.matricNumber));
    const sent = await this.#sendCode(entry, setup.lasuEmail, 'face');
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  /** Step 2: the emailed code opens a short window to take the new photos. */
  async confirmFaceReplace(account: AuthenticatedAccount, code: string): Promise<{ status: 'confirmed'; allowedUntil: string }> {
    const student = await this.#studentAccount(account);
    const entry = await this.#entryFor(student);
    if (!entry || entry.studentUserId !== student.userId) throw notOnList(normalizeMatricNumber(student.matricNumber));
    const email = await this.#checkCode(entry.id, code);
    if (email.toLowerCase() !== student.email.toLowerCase()) throw new StudentError(400, 'That code was sent for something else. Ask for a new one.');
    await this.#replacementAllowance(student.userId);
    const until = new Date(this.#now().getTime() + FACE_REPLACE_WINDOW_SECONDS * 1000);
    if (!(await this.#repository.allowFaceReplacement(student.userId, until))) {
      throw new StudentError(409, 'No face is registered on this account yet. Register it from your account setup.');
    }
    await this.#repository.audit({
      institutionId: student.institutionId,
      actorUserId: null,
      action: 'face_replace_confirmed',
      subjectUserId: student.userId,
      matricNumber: normalizeMatricNumber(student.matricNumber),
      details: 'password and email code confirmed',
    });
    return { status: 'confirmed', allowedUntil: until.toISOString() };
  }

  /**
   * Taking new face photos with Google in place of the emailed code: the
   * password and Google sign-in to the account's own email, in one step.
   */
  async confirmFaceReplaceWithGoogle(account: AuthenticatedAccount, input: { readonly password: string; readonly google: GoogleProofInput }): Promise<{ status: 'confirmed'; allowedUntil: string }> {
    this.#requireGoogle();
    if (!this.#faces) throw new StudentError(503, 'Face registration is not switched on.');
    const student = await this.#studentAccount(account);
    const setup = await this.setup(account);
    if (!setup.faceRegistered) throw new StudentError(409, 'No face is registered on this account yet. Register it from your account setup.');
    if (!setup.emailVerified || !setup.lasuEmail) throw new StudentError(409, 'Confirm your LASU email first.');
    if (!this.#credentials) throw new StudentError(503, 'Password checks are not available right now. Try again later.');
    const verifiedUser = await this.#credentials.verifyStudent(student.email, input.password);
    if (verifiedUser !== student.userId) throw new StudentError(400, 'That password is not right.');
    const confirmed = await this.#googleEmail(input.google, 'face', { jamb: setup.emailKind === 'personal' });
    if (confirmed !== student.email.toLowerCase()) {
      throw new StudentError(400, `You signed in to Google as ${confirmed}, but this account uses ${student.email}. Pick that account on Google’s page.`);
    }
    await this.#replacementAllowance(student.userId);
    const until = new Date(this.#now().getTime() + FACE_REPLACE_WINDOW_SECONDS * 1000);
    if (!(await this.#repository.allowFaceReplacement(student.userId, until))) {
      throw new StudentError(409, 'No face is registered on this account yet. Register it from your account setup.');
    }
    await this.#repository.audit({
      institutionId: student.institutionId,
      actorUserId: null,
      action: 'face_replace_confirmed',
      subjectUserId: student.userId,
      matricNumber: normalizeMatricNumber(student.matricNumber),
      details: 'password and Google sign-in confirmed',
    });
    return { status: 'confirmed', allowedUntil: until.toISOString() };
  }

  async #replacementAllowance(userId: string): Promise<void> {
    const since = new Date(this.#now().getTime() - FACE_REPLACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const recent = await this.#repository.countAudit(userId, 'face_replaced', since);
    if (recent >= FACE_REPLACEMENTS_PER_PERIOD) {
      throw new StudentError(429, `You have taken new face photos ${recent} times in the last ${FACE_REPLACE_PERIOD_DAYS} days, the most allowed. Ask an administrator if your photos need to be taken again.`);
    }
  }

  /**
   * Step 3: the new photos replace the old ones (the old signatures and
   * portrait are overwritten, not kept). They must look like the registered
   * face, so a confirmed request cannot hand the account to someone else; a
   * student whose registered photos are of the wrong person needs an
   * administrator to reset them. The duplicate check against other students
   * applies as at registration.
   */
  async replaceFace(account: AuthenticatedAccount, frames: readonly FaceFrame[]): Promise<{ status: 'replaced'; enrolledAt: string }> {
    if (!this.#faces) throw new StudentError(503, 'Face registration is not switched on.');
    const student = await this.#studentAccount(account);
    const current = await this.#repository.findFaceProfile(student.userId);
    const now = this.#now();
    if (!current) throw new StudentError(409, 'No face is registered on this account yet. Register it from your account setup.');
    if (!current.replaceAllowedUntil || current.replaceAllowedUntil <= now) {
      throw new StudentError(403, 'Confirm with your password and the emailed code first (the confirmation lasts 20 minutes).');
    }
    const matric = normalizeMatricNumber(student.matricNumber);
    const enrolment = await this.#faces.enrol(frames);
    const similarity = current.model === enrolment.model ? this.#faces.similarity(enrolment, current.templates) : null;
    if (similarity !== null && similarity < FACE_LIMITS.match) {
      await this.#repository.audit({
        institutionId: student.institutionId,
        actorUserId: null,
        action: 'face_replace_refused',
        subjectUserId: student.userId,
        matricNumber: matric,
        details: `score=${similarity.toFixed(3)}`,
      });
      throw new StudentError(403, 'These photos do not look like the face registered on your account, so they were not saved. Try again in good light, facing the camera. If your registered photos are of someone else, ask an administrator to reset them.');
    }
    const others = await this.#repository.listFaceCentroids(student.institutionId, student.userId);
    const duplicate = this.#faces.duplicateOf(enrolment.centroid, others);
    if (duplicate) {
      await this.#repository.audit({
        institutionId: student.institutionId,
        actorUserId: null,
        action: 'face_duplicate_refused',
        subjectUserId: student.userId,
        matricNumber: matric,
        details: `replacement score=${duplicate.score.toFixed(3)} other_user=${duplicate.match.userId}`,
      });
      throw new StudentError(409, 'This face is already registered to another student’s account. If that is a mistake, ask your HOC or an administrator.');
    }
    const saved = await this.#repository.replaceFaceProfile({
      userId: student.userId,
      institutionId: student.institutionId,
      model: enrolment.model,
      templates: enrolment.templates,
      centroid: enrolment.centroid,
      photo: enrolment.photo,
      quality: enrolment.quality,
      consentedAt: now,
      now,
    });
    if (saved === 'not_allowed') throw new StudentError(403, 'The confirmation expired. Confirm again with your password and a new code.');
    await this.#repository.audit({
      institutionId: student.institutionId,
      actorUserId: null,
      action: 'face_replaced',
      subjectUserId: student.userId,
      matricNumber: matric,
      details: `model=${enrolment.model} previous_model=${current.model} similarity=${similarity === null ? 'n/a' : similarity.toFixed(3)} live=${enrolment.quality.live} real=${enrolment.quality.real}; old signatures and portrait overwritten`,
    });
    return { status: 'replaced', enrolledAt: now.toISOString() };
  }

  async ownFacePhoto(account: AuthenticatedAccount): Promise<Buffer> {
    const student = await this.#studentAccount(account);
    const photo = await this.#repository.findFacePhoto(student.userId);
    if (!photo) throw new StudentError(404, 'No face is registered on this account.');
    return photo;
  }

  /* ---------------- check-in face gate (used by LectureService) ---------------- */

  /** What the check-in page needs to know before opening the camera. */
  async checkInFaceStatus(userId: string | null, ticket: string): Promise<{ required: boolean; turn: FaceTurn; registered: boolean | null }> {
    const turn = turnForTicket(ticket);
    if (!this.#faces) return { required: false, turn, registered: null };
    const registered = userId ? (await this.#repository.findFaceProfile(userId)) !== null : null;
    return { required: true, turn, registered };
  }

  /**
   * Confirms the student at the camera is the student being marked present.
   * Throws a message for the student when not; returns the match score.
   */
  async verifyCheckInFace(input: {
    readonly userId: string;
    readonly institutionId: string;
    readonly lectureSessionId: string;
    readonly ticket: string;
    readonly frames: readonly FaceFrame[] | undefined;
    readonly takerName: string;
  }): Promise<number | null> {
    if (!this.#faces) return null;
    const profile = await this.#repository.findFaceProfile(input.userId);
    if (!profile) {
      throw new StudentError(409, 'Register your face before marking attendance: open your account and follow “Register your face” (it takes about 30 seconds).');
    }
    if (!input.frames?.length) throw new StudentError(428, 'Look at the camera to confirm it is you.');
    const now = this.#now();
    const failures = await this.#repository.countFaceFailures(input.userId, input.lectureSessionId, new Date(now.getTime() - 30 * 60 * 1000));
    if (failures >= FACE_FAILURES_PER_LECTURE) {
      throw new StudentError(429, `Too many face checks failed for this class. Ask ${input.takerName} to add you to the list.`);
    }
    try {
      const verdict = await this.#faces.verify({ frames: input.frames, turn: turnForTicket(input.ticket), templates: profile.templates, model: profile.model });
      await this.#repository.saveFaceCheck({
        institutionId: input.institutionId,
        lectureSessionId: input.lectureSessionId,
        studentUserId: input.userId,
        score: verdict.score,
        real: verdict.real,
        live: verdict.live,
        needsReview: verdict.needsReview,
        photo: verdict.photo,
        now,
      });
      return verdict.score;
    } catch (error) {
      if (error instanceof FaceCheckError && error.statusCode !== 503) {
        await this.#repository.audit({
          institutionId: input.institutionId,
          actorUserId: null,
          action: 'face_check_failed',
          subjectUserId: input.userId,
          details: `session=${input.lectureSessionId} reason=${error.reason}`,
        });
      }
      throw error;
    }
  }

  async checkInFacePhoto(lectureSessionId: string, studentUserId: string): Promise<Buffer | null> {
    return this.#repository.findFaceCheckPhoto(lectureSessionId, studentUserId);
  }

  /** A student's registered portrait, for the person deciding about them (help requests, reviews). */
  async registeredPhoto(studentUserId: string): Promise<Buffer | null> {
    return this.#repository.findFacePhoto(studentUserId);
  }

  /**
   * Whether a student may ask the session taker to add them by hand: their
   * face check has failed at least FACE_FAILURES_BEFORE_HELP times for this
   * lecture in the last half hour.
   */
  async checkInHelpEligibility(userId: string, lectureSessionId: string): Promise<{ eligible: boolean; failures: number; reason: string; reasonLabel: string }> {
    const since = new Date(this.#now().getTime() - 30 * 60 * 1000);
    const { count, lastReason } = await this.#repository.faceFailures(userId, lectureSessionId, since);
    const reason = lastReason ?? 'unknown';
    return {
      eligible: count >= FACE_FAILURES_BEFORE_HELP,
      failures: count,
      reason,
      reasonLabel: FACE_FAILURE_LABELS[reason] ?? 'Face check did not pass',
    };
  }

  /** Records a help-request event in the student audit trail. */
  async auditCheckInHelp(event: { institutionId: string; actorUserId: string | null; action: 'help_request_created' | 'help_request_added' | 'help_request_declined' | 'face_review_approved' | 'face_review_rejected'; subjectUserId: string; matricNumber: string; details: string }): Promise<void> {
    await this.#repository.audit(event);
  }

  /* ---------------- class lists (HOCs and administrators) ---------------- */

  async #scope(account: AuthenticatedAccount): Promise<ListScope> {
    if (account.accountType === 'administrator') {
      const scope = account.scope;
      return {
        institutionId: scope.institutionId,
        userId: account.id,
        departmentIds: scope.type === 'department' ? new Set([scope.id]) : null,
        facultyIds: scope.type === 'faculty' ? new Set([scope.id]) : null,
        fixedEntryYear: null,
        fixedDepartmentId: scope.type === 'department' ? scope.id : null,
        canResetFaces: true,
        canGiveSetupCodes: true,
      };
    }
    if (account.accountType === 'student') {
      const actor = await this.#repository.findClassListActor(account.id);
      const rep = actor?.classRep;
      // An assistant keeps the class list only when their HOC or GHOC allowed it.
      const may = (permission: string) => !rep?.assistantOfId || (rep.permissions ?? []).includes(permission);
      if (rep && !may('class_list')) {
        throw new StudentError(403, 'Your HOC has not given you the class list. Ask them to allow it on their Assistants page.');
      }
      const canGiveSetupCodes = may('setup_codes');
      if (actor && rep?.role === 'hoc' && rep.departmentId) {
        return {
          institutionId: actor.institutionId,
          userId: account.id,
          departmentIds: new Set([rep.departmentId]),
          facultyIds: null,
          fixedEntryYear: rep.entryYear,
          fixedDepartmentId: rep.departmentId,
          canResetFaces: false,
          canGiveSetupCodes,
        };
      }
      if (actor && rep?.role === 'ghoc') {
        return {
          institutionId: actor.institutionId,
          userId: account.id,
          departmentIds: null,
          facultyIds: new Set([rep.facultyId]),
          fixedEntryYear: rep.entryYear,
          fixedDepartmentId: null,
          canResetFaces: false,
          canGiveSetupCodes,
        };
      }
    }
    throw new StudentError(403, 'Only HOCs, GHOCs and administrators can manage class lists.');
  }

  async #departmentsInScope(scope: ListScope) {
    return this.#inScope(scope, await this.#repository.listDepartments(scope.institutionId));
  }

  #inScope<T extends { readonly id: string; readonly facultyId: string }>(scope: ListScope, all: readonly T[]): T[] {
    return all.filter((department) =>
      (!scope.departmentIds || scope.departmentIds.has(department.id)) &&
      (!scope.facultyIds || scope.facultyIds.has(department.facultyId)));
  }

  /**
   * Where the viewer may move a student who is on the wrong department's list: any
   * department in the faculties they manage lists in (a HOC's whole faculty, so a
   * misplaced student reaches the right list without waiting for an administrator).
   * Across faculties takes an institution administrator.
   */
  #moveTargets<T extends { readonly id: string; readonly facultyId: string }>(scope: ListScope, all: readonly T[]): T[] {
    if (!scope.departmentIds && !scope.facultyIds) return [...all];
    const faculties = new Set(this.#inScope(scope, all).map((department) => department.facultyId));
    return all.filter((department) => faculties.has(department.facultyId));
  }

  #entryInScope(entry: Pick<ClassListRecord, 'departmentId' | 'facultyId' | 'entryYear'>, scope: ListScope): boolean {
    if (scope.departmentIds && !scope.departmentIds.has(entry.departmentId)) return false;
    if (scope.facultyIds && !scope.facultyIds.has(entry.facultyId)) return false;
    if (scope.fixedEntryYear !== null && entry.entryYear !== scope.fixedEntryYear) return false;
    return true;
  }

  #stage(entry: ClassListRecord): ClassListEntryStage {
    if (!entry.studentUserId) return 'not_joined';
    if (!entry.accountEmailVerified) return 'joined';
    if (this.faceRequired && !entry.faceRegistered) return 'email_confirmed';
    return 'ready';
  }

  #toEntry(entry: ClassListRecord): ClassListEntry {
    return {
      id: entry.id,
      matricNumber: entry.matricNumber,
      surname: entry.surname,
      firstName: entry.firstName,
      middleName: entry.middleName,
      lasuEmail: entry.accountEmailVerified ? entry.accountEmail : entry.lasuEmail,
      entryYear: entry.entryYear,
      entryLevel: entry.entryLevel,
      levelLabel: this.#levelLabel(entry),
      departmentId: entry.departmentId,
      departmentName: entry.departmentName,
      stage: this.#stage(entry),
      userId: entry.studentUserId,
      isRep: entry.isRep,
      setupCodeUsed: Boolean(entry.studentUserId) && !entry.accountEmailVerified && entry.accountVouched,
      numberKind: studentNumberKind(entry.matricNumber),
      jambNumber: entry.jambNumber,
      addedByName: entry.addedByName,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async classList(account: AuthenticatedAccount, query: { readonly departmentId?: string | undefined; readonly department?: string | undefined; readonly entryYear?: number | undefined; readonly only?: 'lists' | undefined }): Promise<ClassList> {
    const scope = await this.#scope(account);
    const allDepartments = await this.#repository.listDepartments(scope.institutionId);
    const departments = this.#inScope(scope, allDepartments);
    // A department may be asked for by its code ("ECE"), which is how pages link to a list.
    let asked = query.departmentId;
    if (!asked && query.department) {
      const code = query.department.toUpperCase();
      const match = departments.find((department) => department.code.toUpperCase() === code);
      if (!match) throw new StudentError(404, `There is no department ${query.department} among the lists you manage.`);
      asked = match.id;
    }
    const departmentId = scope.fixedDepartmentId ?? asked ?? (departments.length === 1 ? departments[0]!.id : null);
    if (departmentId && !departments.some((department) => department.id === departmentId)) {
      throw new StudentError(403, 'That department is outside the lists you manage.');
    }
    const entryYear = scope.fixedEntryYear ?? query.entryYear ?? null;
    // An overview needs only the summaries. Once the department and the set are both settled
    // (asked for, or the only ones the viewer has, as for a HOC) it is one list, sent whole.
    const summariesOnly = query.only === 'lists' && !(departmentId !== null && entryYear !== null);
    const records = departmentId && !summariesOnly ? await this.#repository.listEntries(scope.institutionId, departmentId, entryYear) : [];
    const entries = records.map((record) => this.#toEntry(record));
    const history = departmentId && !summariesOnly
      ? await this.#repository.listAudit(scope.institutionId, { matricNumbers: records.map((record) => record.matricNumber), departmentId, entryYear }, 40)
      : [];
    const summaries = await this.#repository.summarizeLists(scope.institutionId, departments.map((department) => department.id), scope.fixedEntryYear);
    return {
      departments: departments.map(({ id, code, name, facultyName }) => ({ id, code, name, facultyName })),
      fixedDepartmentId: scope.fixedDepartmentId,
      fixedEntryYear: scope.fixedEntryYear,
      departmentId,
      entryYear,
      setLabel: entryYear !== null ? academicSetLabel(entryYear) : null,
      entries,
      counts: {
        total: entries.length,
        joined: entries.filter((entry) => entry.stage !== 'not_joined').length,
        emailConfirmed: entries.filter((entry) => entry.stage === 'email_confirmed' || entry.stage === 'ready').length,
        ready: entries.filter((entry) => entry.stage === 'ready').length,
      },
      lists: summaries.map((summary) => ({
        departmentId: summary.departmentId,
        entryYear: summary.entryYear,
        setLabel: academicSetLabel(summary.entryYear),
        total: summary.total,
        joined: summary.opened,
        emailConfirmed: summary.confirmed,
        ready: this.faceRequired ? summary.confirmedWithFace : summary.confirmed,
        updatedAt: summary.updatedAt.toISOString(),
      })),
      faceRequired: this.faceRequired,
      canResetFaces: scope.canResetFaces,
      canGiveSetupCodes: scope.canGiveSetupCodes,
      moveDepartments: this.#moveTargets(scope, allDepartments).map(({ id, code, name, facultyName }) => ({ id, code, name, facultyName })),
      history: history.map((event) => ({
        id: event.id,
        action: event.action,
        summary: studentAuditSummary(event.action),
        actorName: event.actorName,
        matricNumber: event.matricNumber,
        at: event.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Checks (and with `apply`, saves) an uploaded class list. Rows with
   * errors are never saved; when any row has an error nothing is saved, so a
   * list is always all-or-nothing and the HOC fixes it and uploads again.
   */
  async importClassList(account: AuthenticatedAccount, input: ImportInput): Promise<ClassListImportResult> {
    const scope = await this.#scope(account);
    const departments = await this.#departmentsInScope(scope);
    if (!departments.some((department) => department.id === input.departmentId)) {
      throw new StudentError(403, 'You can upload lists only for your own department.');
    }
    if (scope.fixedEntryYear !== null && input.entryYear !== scope.fixedEntryYear) {
      throw new StudentError(403, `You can upload the list for your own set only (${academicSetLabel(scope.fixedEntryYear)}).`);
    }
    const problems: ClassListImportProblem[] = [];
    const rows: ClassListRowWrite[] = [];
    const seenMatric = new Map<string, number>();
    const seenJamb = new Map<string, number>();
    const seenEmail = new Map<string, number>();
    const seenName = new Map<string, number>();
    input.rows.forEach((raw, index) => {
      const row = index + 1;
      // The number the student is known by: a matric number, or a JAMB number while they have none.
      const matricCheck = checkStudentNumber(raw.matricNumber);
      const matric = matricCheck.ok ? matricCheck.value : String(raw.matricNumber ?? '').trim().slice(0, 32);
      const error = (message: string) => problems.push({ row, matricNumber: matric, kind: 'error', message });
      const warn = (message: string) => problems.push({ row, matricNumber: matric, kind: 'warning', message });
      const onJamb = matricCheck.ok && matricCheck.kind === 'jamb';
      // Every problem in the row is reported at once, so the HOC fixes it in one go.
      let rowOk = true;
      if (!matricCheck.ok) {
        error(matricCheck.message);
        rowOk = false;
      } else {
        const earlier = seenMatric.get(matric) ?? (onJamb ? seenJamb.get(matric) : undefined);
        if (earlier) {
          error(`Duplicate: the same ${onJamb ? 'JAMB' : 'matric'} number is on row ${earlier}. Each student can be on the list only once.`);
          rowOk = false;
        } else {
          seenMatric.set(matric, row);
        }
      }
      // A separate JAMB column (next to the matric number) lets an upload switch a student to their matric number.
      let jamb: string | null = onJamb ? matric : null;
      const rawJamb = raw.jambNumber == null ? '' : String(raw.jambNumber).trim();
      if (rawJamb) {
        const jambCheck = checkStudentNumber(rawJamb);
        if (!jambCheck.ok || jambCheck.kind !== 'jamb') {
          error(`The JAMB column has “${rawJamb.slice(0, 20)}”, which is not a JAMB registration number (12 digits and 2 letters, e.g. 202430074987JA). Correct it or leave it empty.`);
          rowOk = false;
        } else if (onJamb && jambCheck.value !== matric) {
          error(`Two different JAMB numbers in one row (${matric} and ${jambCheck.value}). Keep the right one.`);
          rowOk = false;
        } else {
          const earlier = seenJamb.get(jambCheck.value) ?? seenMatric.get(jambCheck.value);
          if (earlier && earlier !== row) {
            error(`Duplicate: the same JAMB number is on row ${earlier}.`);
            rowOk = false;
          } else {
            seenJamb.set(jambCheck.value, row);
            jamb = jambCheck.value;
          }
        }
      } else if (onJamb) {
        seenJamb.set(matric, row);
      }
      const surnameCheck = checkPersonName(raw.surname, 'surname', 'one');
      const firstCheck = checkPersonName(raw.firstName, 'first name', 'one');
      const middleCheck = raw.middleName?.trim() ? checkPersonName(raw.middleName, 'middle name', 'several') : null;
      for (const check of [surnameCheck, firstCheck, middleCheck]) {
        if (check && !check.ok) {
          error(check.message);
          rowOk = false;
        }
      }
      if (!rowOk || !surnameCheck.ok || !firstCheck.ok || (middleCheck && !middleCheck.ok)) return;
      let email: string | null = raw.lasuEmail ? raw.lasuEmail.trim().toLowerCase() : null;
      // A student on a JAMB number has no LASU email yet: a personal one stands in.
      if (email && !isStudentProofEmail(email, { jamb: onJamb })) {
        warn(onJamb
          ? `“${email.slice(0, 60)}” is not a full email address, so it was left out. The student will type theirs.`
          : isPersonalEmail(email)
            ? 'The email is a personal one, not a LASU student email (…@st.lasu.edu.ng), so it was left out. Personal emails are kept only for students listed by JAMB number; this student will type their LASU email.'
            : 'The email is not a LASU student email (…@st.lasu.edu.ng), so it was left out. The student will type theirs.');
        email = null;
      }
      if (email) {
        const emailRow = seenEmail.get(email);
        if (emailRow) {
          error(`The same email is on row ${emailRow}.`);
          return;
        }
        seenEmail.set(email, row);
      }
      const matricYear = onJamb ? null : entryYearFromMatric(matric, input.entryYear + 2);
      const gap = matricYear === null ? 0 : matricYear - input.entryYear;
      let entryLevel = raw.entryLevel;
      if (entryLevel === undefined) {
        // No matric number yet and no entry column: a JAMB number on a class list is a Direct Entry student.
        entryLevel = onJamb ? 200 : gap === 1 ? 200 : gap === 2 ? 300 : 100;
      } else if (matricYear !== null && admissionYear(input.entryYear, entryLevel) !== matricYear) {
        warn(`The matric number starts with ${String(matricYear).slice(2)}, which does not match a ${entryLevel}-level entrant in the ${academicSetLabel(input.entryYear)}. Check the matric number and the entry level.`);
      }
      if (matricYear !== null && (gap < 0 || gap > 2)) {
        warn(`The matric number starts with ${String(matricYear).slice(2)}, so this student may belong to another set.`);
      }
      // The JAMB number starts with the year of the exam, normally the year of admission (or the one before).
      const examYear = jamb ? jambYear(jamb) : null;
      if (examYear !== null) {
        const admitted = admissionYear(input.entryYear, entryLevel);
        if (examYear > admitted || examYear < admitted - 1) {
          warn(`The JAMB number is from ${examYear}, but a ${entryLevel}-level entrant in the ${academicSetLabel(input.entryYear)} was admitted in ${admitted}. Check the JAMB number, the entry level and the set.`);
        }
      }
      const surname = tidyPersonName(surnameCheck.value);
      const firstName = tidyPersonName(firstCheck.value);
      const middle = middleCheck?.ok ? tidyPersonName(middleCheck.value) : null;
      // Namesakes exist, so the same name twice is a warning, not an error.
      const nameKey = `${surname} ${firstName} ${middle ?? ''}`.toLowerCase();
      const sameName = seenName.get(nameKey);
      if (sameName) warn(`Same name as row ${sameName} (${firstName} ${surname}) with a different matric number. Check it is not the same student twice.`);
      else seenName.set(nameKey, row);
      rows.push({
        matricNumber: matric,
        jambNumber: jamb,
        surname,
        firstName,
        middleName: middle,
        lasuEmail: email,
        entryLevel,
      });
    });

    // LASU addresses another student already uses (on a list, or on an account).
    const owners = await this.#repository.findEmailOwners(scope.institutionId, rows.flatMap((row) => (row.lasuEmail ? [row.lasuEmail] : [])));
    for (const row of rows) {
      if (!row.lasuEmail) continue;
      const other = owners.find((owner) => owner.email === row.lasuEmail && owner.matricNumber !== row.matricNumber);
      if (other) {
        problems.push({
          row: seenMatric.get(row.matricNumber)!,
          matricNumber: row.matricNumber,
          kind: 'error',
          message: other.matricNumber
            ? `Duplicate email: ${row.lasuEmail} already belongs to ${other.matricNumber}. Check the email, or leave it empty (the student will type theirs).`
            : `Duplicate email: ${row.lasuEmail} is already used by another account. Check it, or leave it empty.`,
        });
      }
    }

    // Students on the list by JAMB number: a row with their JAMB and matric numbers switches them.
    const jambNumbers = rows.flatMap((row) => (row.jambNumber ? [row.jambNumber] : []));
    const byJamb = new Map((await this.#repository.findEntriesByJamb(scope.institutionId, jambNumbers)).map((entry) => [entry.jambNumber!, entry]));
    const existing = await this.#repository.findEntriesByMatric(scope.institutionId, rows.map((row) => row.matricNumber));
    const byMatric = new Map(existing.map((entry) => [entry.matricNumber, entry]));
    /** Entries switching from a JAMB number to the matric number in this upload, by matric number. */
    const switching = new Map<string, ClassListRecord>();
    for (const row of rows) {
      if (!row.jambNumber) continue;
      const rowNumber = seenMatric.get(row.matricNumber)!;
      const holder = byJamb.get(row.jambNumber);
      const byNumber = byMatric.get(row.matricNumber);
      if (!holder) continue;
      if (row.jambNumber === row.matricNumber) {
        // Listed by JAMB number, but the matric number has already replaced it.
        if (holder.matricNumber !== row.matricNumber) {
          problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'error', message: `${holder.firstName} ${holder.surname} already has the matric number ${holder.matricNumber} in place of this JAMB number. Use ${holder.matricNumber}.` });
        }
        continue;
      }
      if (byNumber && byNumber.id !== holder.id) {
        problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'error', message: `${row.jambNumber} (${holder.firstName} ${holder.surname}) and ${row.matricNumber} (${byNumber.firstName} ${byNumber.surname}) are on the list as two students. If they are the same person, remove the one without an account, then upload again.` });
        continue;
      }
      if (byNumber) continue;
      if (holder.matricNumber !== row.jambNumber) {
        problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'error', message: `The JAMB number ${row.jambNumber} belongs to ${holder.firstName} ${holder.surname}, whose matric number is ${holder.matricNumber}. Check both numbers.` });
        continue;
      }
      switching.set(row.matricNumber, holder);
      problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'warning', message: `Gets the matric number ${row.matricNumber} in place of JAMB number ${row.jambNumber}.${holder.studentUserId ? ' Their account, attendance and face carry over; registers show the matric number from now on.' : ''}` });
    }
    // A matric-number row whose name matches a student listed by JAMB number on this list: probably the same person.
    const jambOnList = (await this.#repository.listEntries(scope.institutionId, input.departmentId, input.entryYear))
      .filter((entry) => isJambRegNumber(entry.matricNumber));
    if (jambOnList.length) {
      const nameOf = (person: { surname: string; firstName: string }) => `${person.surname} ${person.firstName}`.toLowerCase();
      const waiting = new Map(jambOnList.map((entry) => [nameOf(entry), entry]));
      for (const row of rows) {
        if (isJambRegNumber(row.matricNumber) || row.jambNumber || byMatric.has(row.matricNumber)) continue;
        const twin = waiting.get(nameOf(row));
        if (!twin) continue;
        problems.push({
          row: seenMatric.get(row.matricNumber)!,
          matricNumber: row.matricNumber,
          kind: 'warning',
          message: `${row.firstName} ${row.surname} is already on this list by JAMB number ${twin.matricNumber}. If it is the same student, add a JAMB column with ${twin.matricNumber} (or edit them and type the matric number) so they keep one account and their attendance; as it is, they would be listed twice.`,
        });
      }
    }
    // Students already on another department's or set's list.
    for (const [matric, holder] of switching) byMatric.set(matric, holder);
    for (const row of rows) {
      const entry = byMatric.get(row.matricNumber);
      if (!entry) continue;
      const rowNumber = seenMatric.get(row.matricNumber)!;
      if (entry.departmentId !== input.departmentId || entry.entryYear !== input.entryYear) {
        if (!this.#entryInScope(entry, scope)) {
          problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'error', message: `Already on the ${entry.departmentName} list (${academicSetLabel(entry.entryYear)}). Ask that HOC or an administrator to move them.` });
        } else {
          problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'warning', message: `Moves from the ${entry.departmentName} list (${academicSetLabel(entry.entryYear)}) to this one.` });
        }
      }
      if (entry.studentUserId && (entry.surname !== row.surname || entry.firstName !== row.firstName || (entry.middleName ?? null) !== row.middleName)) {
        problems.push({ row: rowNumber, matricNumber: row.matricNumber, kind: 'warning', message: `Renames ${entry.firstName} ${entry.surname}, who has an account, to ${row.firstName} ${row.surname}.` });
      }
    }

    const hasErrors = problems.some((problem) => problem.kind === 'error');
    problems.sort((a, b) => a.row - b.row || (a.kind === b.kind ? 0 : a.kind === 'error' ? -1 : 1));
    if (!input.apply || hasErrors) {
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      for (const row of rows) {
        const entry = byMatric.get(row.matricNumber);
        if (!entry) added += 1;
        else if (switching.has(row.matricNumber)) updated += 1;
        else if (entry.surname === row.surname && entry.firstName === row.firstName && (entry.middleName ?? null) === row.middleName
          && (row.lasuEmail === null || entry.lasuEmail === row.lasuEmail) && entry.entryLevel === row.entryLevel
          && entry.departmentId === input.departmentId && entry.entryYear === input.entryYear) unchanged += 1;
        else updated += 1;
      }
      return { applied: false, added, updated, unchanged, linked: 0, switched: switching.size, onJamb: rows.filter((row) => isJambRegNumber(row.matricNumber)).length, problems };
    }
    const outcome = await this.#repository.importEntries({
      institutionId: scope.institutionId,
      departmentId: input.departmentId,
      entryYear: input.entryYear,
      rows,
      actorUserId: scope.userId,
      now: this.#now(),
    });
    return { applied: true, ...outcome, onJamb: rows.filter((row) => isJambRegNumber(row.matricNumber)).length, problems };
  }

  async #entryForManager(account: AuthenticatedAccount, entryId: string): Promise<{ scope: ListScope; entry: ClassListRecord }> {
    const scope = await this.#scope(account);
    const entry = await this.#repository.findEntryById(scope.institutionId, entryId);
    if (!entry || !this.#entryInScope(entry, scope)) throw new StudentError(404, 'That student is not on a list you manage.');
    return { scope, entry };
  }

  async updateEntry(account: AuthenticatedAccount, entryId: string, changes: ClassListEntryUpdate): Promise<ClassListEntry> {
    const { scope, entry } = await this.#entryForManager(account, entryId);
    const write: { -readonly [K in keyof ClassListRowWrite]?: ClassListRowWrite[K] } = {};
    // The route already validated the shape; checked again here so the service stands on its own.
    let number = entry.matricNumber;
    if (changes.matricNumber !== undefined) {
      const matric = checkStudentNumber(changes.matricNumber);
      if (!matric.ok) throw new StudentError(422, matric.message);
      // The matric number is the account's identity: once an account is open,
      // only an administrator may correct it (it is then copied to the account).
      // The one change a HOC makes for a student with an account is the expected
      // one: a JAMB number replaced by the matric number when it arrives.
      const arriving = isJambRegNumber(entry.matricNumber) && matric.kind === 'matric';
      if (matric.value !== entry.matricNumber && entry.studentUserId && !scope.canResetFaces && !arriving) {
        throw new StudentError(403, `${entry.firstName} ${entry.surname} has opened an account with ${entry.matricNumber}, so only an administrator can change the ${studentNumberName(entry.matricNumber)}.`);
      }
      if (matric.kind === 'jamb' && entry.jambNumber && entry.jambNumber !== matric.value && !isJambRegNumber(entry.matricNumber)) {
        throw new StudentError(422, `${entry.firstName} ${entry.surname} already has their matric number. Their JAMB number (${entry.jambNumber}) is kept for reference.`);
      }
      write.matricNumber = matric.value;
      number = matric.value;
    }
    const name = (value: string, label: string, words: 'one' | 'several') => {
      const check = checkPersonName(value, label, words);
      if (!check.ok) throw new StudentError(422, check.message);
      return tidyPersonName(check.value);
    };
    if (changes.surname !== undefined) write.surname = name(changes.surname, 'surname', 'one');
    if (changes.firstName !== undefined) write.firstName = name(changes.firstName, 'first name', 'one');
    if (changes.middleName !== undefined) write.middleName = changes.middleName?.trim() ? name(changes.middleName, 'middle name', 'several') : null;
    if (changes.entryLevel !== undefined) write.entryLevel = changes.entryLevel;
    if (changes.lasuEmail !== undefined) {
      const email = changes.lasuEmail?.trim().toLowerCase() || null;
      const jamb = isJambRegNumber(number);
      if (email && !isStudentProofEmail(email, { jamb })) {
        throw new StudentError(422, jamb
          ? 'Enter a full email address the student can open (a personal one is fine while they are on a JAMB number), or leave it empty.'
          : 'Use the student’s LASU email (…@st.lasu.edu.ng), or leave it empty. Personal emails are only for students on a JAMB number.');
      }
      // A confirmed address is the student's to change. The exception: a student who joined on a
      // JAMB number confirmed a personal one, and their LASU email may go on the list for them to confirm.
      const personalStandIn = entry.accountEmail !== null && !isLasuStudentEmail(entry.accountEmail) && !jamb && email !== null && isLasuStudentEmail(email);
      if (entry.accountEmailVerified && email !== entry.accountEmail && !personalStandIn) {
        throw new StudentError(409, `This student has already confirmed their ${isLasuStudentEmail(entry.accountEmail ?? '') ? 'LASU email' : 'email'}, so it cannot be changed here.`);
      }
      write.lasuEmail = email;
    }
    const result = await this.#repository.updateEntry({ entryId, institutionId: scope.institutionId, changes: write, actorUserId: scope.userId, now: this.#now() });
    if (result === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
    if (result === 'matric_taken') {
      const other = write.matricNumber ? await this.#entryByNumber(scope.institutionId, write.matricNumber) : null;
      throw new StudentError(409, other
        ? `Duplicate: ${write.matricNumber} is already on the ${other.departmentName} list (${academicSetLabel(other.entryYear)}) as ${other.firstName} ${other.surname}.`
        : 'Duplicate: another student on a class list already has that matric number.');
    }
    if (result === 'email_taken') throw new StudentError(409, 'Another student already uses that LASU email.');
    const updated = await this.#repository.findEntryById(scope.institutionId, entryId);
    return this.#toEntry(updated!);
  }

  /**
   * Moves a student who is on the wrong department's list to the right one, for the same
   * set. Their account, attendance, courses and face stay; their department follows.
   */
  async moveEntry(account: AuthenticatedAccount, entryId: string, departmentId: string): Promise<ClassListEntry> {
    const { scope, entry } = await this.#entryForManager(account, entryId);
    const all = await this.#repository.listDepartments(scope.institutionId);
    const target = this.#moveTargets(scope, all).find((department) => department.id === departmentId);
    if (!target) {
      throw new StudentError(403, all.some((department) => department.id === departmentId)
        ? 'You can move students only within your faculty. For another faculty, ask an administrator.'
        : 'That department is not open.');
    }
    const result = await this.#repository.moveEntry({ entryId, institutionId: scope.institutionId, departmentId, actorUserId: scope.userId, now: this.#now() });
    if (result === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
    if (result === 'unchanged') throw new StudentError(409, `${entry.firstName} ${entry.surname} is already on the ${target.name} list.`);
    if (result === 'is_rep') throw new StudentError(409, `${entry.firstName} ${entry.surname} is a class rep for this department. Remove them as a rep first, then move them.`);
    const moved = await this.#repository.findEntryById(scope.institutionId, entryId);
    return this.#toEntry(moved!);
  }

  async removeEntry(account: AuthenticatedAccount, entryId: string): Promise<void> {
    const { scope } = await this.#entryForManager(account, entryId);
    const result = await this.#repository.removeEntry({ entryId, institutionId: scope.institutionId, actorUserId: scope.userId });
    if (result === 'linked') throw new StudentError(409, 'This student has opened an account, so they cannot be removed from the list. Correct their details instead.');
    if (result === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
  }

  /**
   * A one-time setup code for a student who cannot get the emailed code (no
   * LASU email yet, mailbox not working). It opens their account, or takes
   * over an older one whose email was never confirmed, once, within
   * SETUP_CODE_TTL_MINUTES. Not for accounts with a confirmed LASU email:
   * those reset their password with a code sent to it, so no one else can
   * ever be handed a working account.
   */
  async issueSetupCode(account: AuthenticatedAccount, entryId: string): Promise<SetupCodeIssued> {
    const { scope, entry } = await this.#entryForManager(account, entryId);
    if (entry.studentUserId && entry.accountEmailVerified) {
      throw new StudentError(409, `${entry.firstName} ${entry.surname} already confirmed ${entry.accountEmail}. Forgot the password? They type their matric number on the sign-up page, then “Reset my password with a code”. Not their email? An administrator can release the account.`);
    }
    if (entry.studentUserId === scope.userId) throw new StudentError(403, 'You cannot give yourself a setup code.');
    if (!scope.canGiveSetupCodes) throw new StudentError(403, 'Your HOC has not allowed you to give setup codes. Ask them, or ask them to give this one.');
    const code = newSetupCode();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + SETUP_CODE_TTL_MINUTES * 60 * 1000);
    await this.#repository.issueSetupCode({ entryId: entry.id, codeHash: setupCodeHash(entry.id, code), issuedByUserId: scope.userId, now, expiresAt });
    const takesOver = Boolean(await this.#olderAccount(entry));
    await this.#repository.audit({
      institutionId: scope.institutionId,
      actorUserId: scope.userId,
      action: 'setup_code_issued',
      subjectUserId: entry.studentUserId,
      matricNumber: entry.matricNumber,
      details: `one-time setup code, valid ${SETUP_CODE_TTL_MINUTES} minutes${takesOver ? '; takes over the older unconfirmed account' : ''}`,
    });
    return {
      status: 'issued',
      code: formatSetupCode(code),
      expiresAt: expiresAt.toISOString(),
      matricNumber: entry.matricNumber,
      studentName: classListName(entry),
      takesOver,
    };
  }

  /**
   * Administrators only: takes a confirmed account away from whoever confirmed
   * it, for when the class list had the wrong LASU email or someone else got
   * in. The real student's LASU email goes on the list, so only that address
   * (or a setup code) can open the account again; whoever had it is signed
   * out, can no longer sign in, and is told by email. Attendance stays.
   */
  async releaseAccount(account: AuthenticatedAccount, entryId: string, input: { readonly email: string; readonly reason: string }): Promise<AccountReleased> {
    const { scope, entry } = await this.#entryForManager(account, entryId);
    if (!scope.canResetFaces) throw new StudentError(403, 'Only administrators can release an account.');
    const email = input.email.trim().toLowerCase();
    if (!isStudentProofEmail(email, { jamb: isJambRegNumber(entry.matricNumber) })) {
      throw new StudentError(422, isJambRegNumber(entry.matricNumber)
        ? 'Enter the student’s own email address (they are on a JAMB number, so a personal one is fine).'
        : 'Use the student’s LASU email (…@st.lasu.edu.ng).');
    }
    const reason = input.reason.trim().replace(/\s+/g, ' ');
    if (reason.length < 5) throw new StudentError(422, 'Say briefly why the account is being released.');
    const now = this.#now();
    const result = await this.#repository.releaseAccount({
      entryId: entry.id,
      institutionId: scope.institutionId,
      listEmail: email,
      // A password nobody knows: the account opens again only through the class list.
      unusablePasswordHash: await hashPassword(createOpaqueToken()),
      actorUserId: scope.userId,
      reason,
      now,
    });
    if (result.kind === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
    if (result.kind === 'not_proven') {
      throw new StudentError(409, `${entry.firstName} ${entry.surname}’s account has no confirmed LASU email, so there is nothing to release: the student opens it with a code to their LASU email, or a setup code, and it moves to them.`);
    }
    if (result.kind === 'same_email') throw new StudentError(422, `${email} is the address already confirmed on the account. Enter the real student’s LASU email.`);
    if (result.kind === 'email_taken') throw new StudentError(409, 'Another student or account already uses that LASU email. Check it with the student.');
    if (result.kind !== 'released') throw new StudentError(409, 'The account could not be released. Try again.');
    this.#logger?.warn({ matricNumber: entry.matricNumber }, 'A confirmed student account was released by an administrator');
    await this.#notify(result.previousEmail, 'LASUATOS user', 'account_released', entry.matricNumber);
    return {
      status: 'released',
      matricNumber: entry.matricNumber,
      studentName: classListName(entry),
      previousEmail: result.previousEmail,
      listedEmail: email,
      signedOutSessions: result.signedOutSessions,
      faceDeleted: result.faceDeleted,
    };
  }

  /** Administrators only: lets a student register their face again (new phone, wrong photo). */
  async resetFace(account: AuthenticatedAccount, entryId: string): Promise<void> {
    const { scope, entry } = await this.#entryForManager(account, entryId);
    if (!scope.canResetFaces) throw new StudentError(403, 'Only administrators can reset a registered face.');
    if (!entry.studentUserId || !(await this.#repository.deleteFaceProfile(entry.studentUserId))) {
      throw new StudentError(404, 'This student has no registered face.');
    }
    await this.#repository.audit({
      institutionId: scope.institutionId,
      actorUserId: scope.userId,
      action: 'face_reset',
      subjectUserId: entry.studentUserId,
      matricNumber: entry.matricNumber,
      details: 'registered face deleted; the student can register again',
    });
  }

  /** The registered portrait, for the student's HOC or an administrator to recognise them. */
  async entryPhoto(account: AuthenticatedAccount, entryId: string): Promise<Buffer> {
    const { entry } = await this.#entryForManager(account, entryId);
    const photo = entry.studentUserId ? await this.#repository.findFacePhoto(entry.studentUserId) : null;
    if (!photo) throw new StudentError(404, 'This student has not registered their face.');
    return photo;
  }
}
