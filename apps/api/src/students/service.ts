import { createHash, randomInt } from 'node:crypto';
import {
  academicSessionStartYear,
  academicSetLabel,
  deriveStudentLevel,
  entryYearFromMatric,
  isLasuMatricNumber,
  isLasuStudentEmail,
  maskedEmail,
  maskedStudentName,
  normalizeMatricNumber,
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
  type StudentSetup,
} from '@lasuatos/contracts';
import { createOpaqueToken, hashOpaqueToken, hashPassword } from '@lasuatos/auth';
import type { z } from 'zod';
import type { ClassListImportRequestSchema } from '@lasuatos/contracts';
import type { AuthenticatedAccount } from '../auth/repository.js';
import { SESSION_TTL_MILLISECONDS, type SecurityEventLogger } from '../auth/service.js';
import { emailFailureReason, type StudentEmailCodeSender } from '../email/transport.js';
import { FaceCheckError, turnForTicket, type FaceVerifier } from './face.js';
import { admissionYear } from './postgres-repository.js';
import type { ClassListRecord, ClassListRowWrite, StudentRepository } from './repository.js';

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

const notOnList = (matric: string) => new StudentError(404, `${matric} is not on a class list yet. Ask your HOC to add you (they upload the class list in LASUATOS), then try again.`);

type ImportInput = z.output<typeof ClassListImportRequestSchema>;

interface ListScope {
  readonly institutionId: string;
  readonly userId: string;
  readonly departmentIds: ReadonlySet<string> | null;
  readonly facultyIds: ReadonlySet<string> | null;
  readonly fixedEntryYear: number | null;
  readonly fixedDepartmentId: string | null;
  readonly canResetFaces: boolean;
}

export interface StudentServiceOptions {
  readonly repository: StudentRepository;
  readonly institutionSlug: string;
  readonly emailSender?: StudentEmailCodeSender | undefined;
  /** Absent: faces are not checked (registration skips the camera, check-ins skip the face check). */
  readonly faces?: FaceVerifier | undefined;
  readonly now?: () => Date;
  readonly logger?: SecurityEventLogger;
}

function codeHash(entryId: string, email: string, code: string): string {
  return createHash('sha256').update(`${entryId}:${email.toLowerCase()}:${code}`).digest('hex');
}

const AUDIT_SUMMARIES: Record<string, string> = {
  class_list_imported: 'Uploaded the class list',
  class_list_entry_updated: 'Corrected a student',
  class_list_entry_removed: 'Removed a student',
  account_opened: 'Opened their account',
  email_confirmed: 'Confirmed their LASU email',
  face_registered: 'Registered their face',
  face_reset: 'Reset a registered face',
  face_check_failed: 'Face check failed at check-in',
  face_duplicate_refused: 'Face matched another student; refused',
};

export class StudentService {
  readonly #repository: StudentRepository;
  readonly #institutionSlug: string;
  readonly #emailSender: StudentEmailCodeSender | undefined;
  readonly #faces: FaceVerifier | undefined;
  readonly #now: () => Date;
  readonly #logger: SecurityEventLogger | undefined;
  #institutionId: string | null = null;

  constructor(options: StudentServiceOptions) {
    this.#repository = options.repository;
    this.#institutionSlug = options.institutionSlug;
    this.#emailSender = options.emailSender;
    this.#faces = options.faces;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
  }

  get faceRequired(): boolean {
    return this.#faces !== undefined;
  }

  async #institution(): Promise<string> {
    if (this.#institutionId) return this.#institutionId;
    const id = await this.#repository.findInstitutionId(this.#institutionSlug);
    if (!id) throw new StudentError(503, 'Student accounts are not set up yet.');
    this.#institutionId = id;
    return id;
  }

  #levelLabel(entry: Pick<ClassListRecord, 'matricNumber' | 'entryYear' | 'entryLevel'>): string {
    return deriveStudentLevel({
      matricNumber: entry.matricNumber,
      entryYear: admissionYear(entry.entryYear, entry.entryLevel),
      entryLevel: entry.entryLevel,
      sessionStartYear: academicSessionStartYear({ now: this.#now() }),
    }).label;
  }

  #matric(raw: string): string {
    const matric = normalizeMatricNumber(raw);
    if (!isLasuMatricNumber(matric)) throw new StudentError(422, 'Enter your matric number: 9 digits, e.g. 250211184.');
    return matric;
  }

  /* ---------------- opening an account ---------------- */

  /** What the sign-up page shows after the student types their matric number. */
  async lookup(rawMatric: string): Promise<ClassListLookupResult> {
    const matric = this.#matric(rawMatric);
    const entry = await this.#repository.findEntryByMatric(await this.#institution(), matric);
    if (!entry) return { status: 'not_found', matricNumber: matric };
    return {
      status: 'found',
      matricNumber: matric,
      maskedName: maskedStudentName(entry),
      departmentName: entry.departmentName,
      levelLabel: this.#levelLabel(entry),
      hasAccount: entry.studentUserId !== null,
      emailOnList: entry.lasuEmail !== null,
    };
  }

  async #sendCode(entry: ClassListRecord, email: string, purpose: 'open' | 'move'): Promise<{ email: string; resendInSeconds: number }> {
    if (!this.#emailSender) throw new StudentError(503, 'Email is not set up, so codes cannot be sent right now. Tell your HOC.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = this.#now();
    const issued = await this.#repository.issueEmailCode({
      entryId: entry.id,
      email,
      codeHash: codeHash(entry.id, email, code),
      now,
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_SECONDS * 1000),
      cooldownSeconds: EMAIL_CODE_COOLDOWN_SECONDS,
      dailyCap: EMAIL_CODE_DAILY_CAP,
    });
    if (issued.kind === 'cooldown') {
      throw new StudentError(429, `A code was sent a moment ago. Check your LASU inbox (and Spam), or ask for a new one in ${issued.retryAfterSeconds} seconds.`);
    }
    if (issued.kind === 'daily_cap') {
      throw new StudentError(429, 'Too many codes have been sent for this matric number today. Try again tomorrow, or ask your HOC for help.');
    }
    try {
      await this.#emailSender.sendStudentEmailCode({
        to: email,
        displayName: entry.firstName,
        code,
        expiresInMinutes: EMAIL_CODE_TTL_SECONDS / 60,
        purpose,
      });
    } catch (error) {
      this.#logger?.warn({ reason: emailFailureReason(error) }, 'Student email code could not be delivered');
      throw new StudentError(502, 'The code could not be sent just now. Try again in a minute.');
    }
    return { email: maskedEmail(email), resendInSeconds: EMAIL_CODE_COOLDOWN_SECONDS };
  }

  /**
   * Which LASU address a code goes to: the one on the class list when the
   * HOC supplied it (typing a different one is refused), otherwise the one
   * the student types.
   */
  async #codeAddress(entry: ClassListRecord, typed: string | undefined, exceptUserId: string | null): Promise<string> {
    const listed = entry.lasuEmail?.toLowerCase() ?? null;
    if (listed && typed && typed.toLowerCase() !== listed) {
      throw new StudentError(422, `Your class list has a different LASU email for you (${maskedEmail(listed)}). Use that one, or ask your HOC to correct it.`);
    }
    const email = (listed ?? typed)?.toLowerCase();
    if (!email) throw new StudentError(422, 'Enter your LASU student email (…@st.lasu.edu.ng).');
    if (!isLasuStudentEmail(email)) throw new StudentError(422, 'Use your LASU student email (…@st.lasu.edu.ng).');
    if (await this.#repository.emailInUse(entry.institutionId, email, { exceptUserId, exceptEntryId: entry.id })) {
      throw new StudentError(409, 'That LASU email is already used by another student. Check it, or ask your HOC for help.');
    }
    return email;
  }

  async requestOpeningCode(input: { readonly matricNumber: string; readonly email?: string | undefined }) {
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#repository.findEntryByMatric(await this.#institution(), matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId) throw new StudentError(409, 'An account is already open for this matric number. Sign in instead (your password starts with LASU unless you changed it).');
    const email = await this.#codeAddress(entry, input.email, null);
    const sent = await this.#sendCode(entry, email, 'open');
    return { status: 'sent' as const, email: sent.email, expiresInSeconds: EMAIL_CODE_TTL_SECONDS, resendInSeconds: sent.resendInSeconds };
  }

  async #checkCode(entryId: string, code: string): Promise<string> {
    const result = await this.#repository.checkEmailCode({
      entryId,
      hashFor: (email) => codeHash(entryId, email, code),
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
   * LASU-style starting password, which the student can change later.
   */
  async openAccount(input: { readonly matricNumber: string; readonly code: string }): Promise<{ token: string; userId: string; startingPassword: string }> {
    const institutionId = await this.#institution();
    const matric = this.#matric(input.matricNumber);
    const entry = await this.#repository.findEntryByMatric(institutionId, matric);
    if (!entry) throw notOnList(matric);
    if (entry.studentUserId) throw new StudentError(409, 'An account is already open for this matric number. Sign in instead.');
    const email = await this.#checkCode(entry.id, input.code);
    const password = startingPassword(entry.matricNumber, entry.surname);
    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.openAccount({
      entryId: entry.id,
      institutionId,
      email,
      passwordHash: await hashPassword(password),
      sessionTokenHash: hashOpaqueToken(token),
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
      now,
    });
    if (result.kind === 'claimed') throw new StudentError(409, 'An account is already open for this matric number. Sign in instead.');
    if (result.kind === 'email_taken') throw new StudentError(409, 'That LASU email is already used by another account. Ask your HOC for help.');
    if (result.kind === 'matric_taken') throw new StudentError(409, 'An older account already uses this matric number. Sign in with it, then confirm your LASU email from your account.');
    return { token, userId: result.userId, startingPassword: password };
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
    const emailVerified = linked && student.emailVerified && isLasuStudentEmail(student.email);
    const faceRegistered = (await this.#repository.findFaceProfile(student.userId)) !== null;
    return {
      classList: entry ? {
        surname: entry.surname,
        firstName: entry.firstName,
        middleName: entry.middleName,
        departmentName: entry.departmentName,
        facultyName: entry.facultyName,
        levelLabel: this.#levelLabel(entry),
        setLabel: academicSetLabel(entry.entryYear),
        listedEmail: entry.lasuEmail ? maskedEmail(entry.lasuEmail) : null,
      } : null,
      emailVerified,
      lasuEmail: emailVerified ? student.email : null,
      faceRequired: this.faceRequired,
      faceRegistered,
      defaultPassword: student.passwordIsDefault,
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
    if (result === 'claimed') throw new StudentError(409, 'Another account has already been opened for this matric number. Ask your HOC for help.');
    if (result === 'email_taken') throw new StudentError(409, 'That LASU email is already used by another account. Ask your HOC for help.');
    return { status: 'verified', email };
  }

  /** Registers the signed-in student's face (once; an administrator can reset it). */
  async enrolFace(account: AuthenticatedAccount, frames: readonly FaceFrame[]): Promise<{ status: 'registered'; enrolledAt: string }> {
    if (!this.#faces) throw new StudentError(503, 'Face registration is not switched on.');
    const student = await this.#studentAccount(account);
    const setup = await this.setup(account);
    if (!setup.classList) throw notOnList(normalizeMatricNumber(student.matricNumber));
    if (!setup.emailVerified) throw new StudentError(409, 'Confirm your LASU email first.');
    if (setup.faceRegistered) throw new StudentError(409, 'Your face is already registered. If it needs to be taken again, ask an administrator to reset it.');
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
      };
    }
    if (account.accountType === 'student') {
      const actor = await this.#repository.findClassListActor(account.id);
      const rep = actor?.classRep;
      if (actor && rep?.role === 'hoc' && rep.departmentId) {
        return {
          institutionId: actor.institutionId,
          userId: account.id,
          departmentIds: new Set([rep.departmentId]),
          facultyIds: null,
          fixedEntryYear: rep.entryYear,
          fixedDepartmentId: rep.departmentId,
          canResetFaces: false,
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
        };
      }
    }
    throw new StudentError(403, 'Only HOCs, GHOCs and administrators can manage class lists.');
  }

  async #departmentsInScope(scope: ListScope) {
    const all = await this.#repository.listDepartments(scope.institutionId);
    return all.filter((department) =>
      (!scope.departmentIds || scope.departmentIds.has(department.id)) &&
      (!scope.facultyIds || scope.facultyIds.has(department.facultyId)));
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
      addedByName: entry.addedByName,
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  async classList(account: AuthenticatedAccount, query: { readonly departmentId?: string | undefined; readonly entryYear?: number | undefined }): Promise<ClassList> {
    const scope = await this.#scope(account);
    const departments = await this.#departmentsInScope(scope);
    const departmentId = scope.fixedDepartmentId ?? query.departmentId ?? (departments.length === 1 ? departments[0]!.id : null);
    if (departmentId && !departments.some((department) => department.id === departmentId)) {
      throw new StudentError(403, 'That department is outside the lists you manage.');
    }
    const entryYear = scope.fixedEntryYear ?? query.entryYear ?? null;
    const records = departmentId ? await this.#repository.listEntries(scope.institutionId, departmentId, entryYear) : [];
    const entries = records.map((record) => this.#toEntry(record));
    const history = departmentId
      ? await this.#repository.listAudit(scope.institutionId, { matricNumbers: records.map((record) => record.matricNumber), departmentId, entryYear }, 40)
      : [];
    return {
      departments: departments.map(({ id, name, facultyName }) => ({ id, name, facultyName })),
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
      faceRequired: this.faceRequired,
      canResetFaces: scope.canResetFaces,
      history: history.map((event) => ({
        id: event.id,
        action: event.action,
        summary: AUDIT_SUMMARIES[event.action] ?? event.action.replace(/_/g, ' '),
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
    const seenEmail = new Map<string, number>();
    input.rows.forEach((raw, index) => {
      const row = index + 1;
      const matric = normalizeMatricNumber(raw.matricNumber);
      const error = (message: string) => problems.push({ row, matricNumber: matric || raw.matricNumber, kind: 'error', message });
      const warn = (message: string) => problems.push({ row, matricNumber: matric, kind: 'warning', message });
      if (!isLasuMatricNumber(matric)) {
        error('The matric number should be 9 digits, e.g. 250211184.');
        return;
      }
      const earlier = seenMatric.get(matric);
      if (earlier) {
        error(`The same matric number is on row ${earlier}.`);
        return;
      }
      seenMatric.set(matric, row);
      let email: string | null = raw.lasuEmail ? raw.lasuEmail.trim().toLowerCase() : null;
      if (email && !isLasuStudentEmail(email)) {
        warn('The email is not a LASU student email (…@st.lasu.edu.ng), so it was left out. The student will type theirs.');
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
      const matricYear = entryYearFromMatric(matric, input.entryYear + 2);
      const gap = matricYear === null ? 0 : matricYear - input.entryYear;
      let entryLevel = raw.entryLevel;
      if (entryLevel === undefined) {
        entryLevel = gap === 1 ? 200 : gap === 2 ? 300 : 100;
      } else if (matricYear !== null && admissionYear(input.entryYear, entryLevel) !== matricYear) {
        warn(`The matric number starts with ${String(matricYear).slice(2)}, which does not match a ${entryLevel}-level entrant in the ${academicSetLabel(input.entryYear)}. Check the matric number and the entry level.`);
      }
      if (matricYear !== null && (gap < 0 || gap > 2)) {
        warn(`The matric number starts with ${String(matricYear).slice(2)}, so this student may belong to another set.`);
      }
      const middle = raw.middleName?.trim() ? tidyPersonName(raw.middleName) : null;
      rows.push({
        matricNumber: matric,
        surname: tidyPersonName(raw.surname),
        firstName: tidyPersonName(raw.firstName),
        middleName: middle,
        lasuEmail: email,
        entryLevel,
      });
    });

    // Students already on another department's or set's list.
    const existing = await this.#repository.findEntriesByMatric(scope.institutionId, rows.map((row) => row.matricNumber));
    const byMatric = new Map(existing.map((entry) => [entry.matricNumber, entry]));
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
        else if (entry.surname === row.surname && entry.firstName === row.firstName && (entry.middleName ?? null) === row.middleName
          && (row.lasuEmail === null || entry.lasuEmail === row.lasuEmail) && entry.entryLevel === row.entryLevel
          && entry.departmentId === input.departmentId && entry.entryYear === input.entryYear) unchanged += 1;
        else updated += 1;
      }
      return { applied: false, added, updated, unchanged, linked: 0, problems };
    }
    const outcome = await this.#repository.importEntries({
      institutionId: scope.institutionId,
      departmentId: input.departmentId,
      entryYear: input.entryYear,
      rows,
      actorUserId: scope.userId,
      now: this.#now(),
    });
    return { applied: true, ...outcome, problems };
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
    if (changes.matricNumber !== undefined) {
      const matric = normalizeMatricNumber(changes.matricNumber);
      if (!isLasuMatricNumber(matric)) throw new StudentError(422, 'The matric number should be 9 digits, e.g. 250211184.');
      write.matricNumber = matric;
    }
    if (changes.surname !== undefined) write.surname = tidyPersonName(changes.surname);
    if (changes.firstName !== undefined) write.firstName = tidyPersonName(changes.firstName);
    if (changes.middleName !== undefined) write.middleName = changes.middleName?.trim() ? tidyPersonName(changes.middleName) : null;
    if (changes.entryLevel !== undefined) write.entryLevel = changes.entryLevel;
    if (changes.lasuEmail !== undefined) {
      const email = changes.lasuEmail?.trim().toLowerCase() || null;
      if (email && !isLasuStudentEmail(email)) throw new StudentError(422, 'Use the student’s LASU email (…@st.lasu.edu.ng), or leave it empty.');
      if (entry.accountEmailVerified && email !== entry.accountEmail) {
        throw new StudentError(409, 'This student has already confirmed their LASU email, so it cannot be changed here.');
      }
      write.lasuEmail = email;
    }
    const result = await this.#repository.updateEntry({ entryId, institutionId: scope.institutionId, changes: write, actorUserId: scope.userId, now: this.#now() });
    if (result === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
    if (result === 'matric_taken') throw new StudentError(409, 'Another student on a class list already has that matric number.');
    if (result === 'email_taken') throw new StudentError(409, 'Another student already uses that LASU email.');
    const updated = await this.#repository.findEntryById(scope.institutionId, entryId);
    return this.#toEntry(updated!);
  }

  async removeEntry(account: AuthenticatedAccount, entryId: string): Promise<void> {
    const { scope } = await this.#entryForManager(account, entryId);
    const result = await this.#repository.removeEntry({ entryId, institutionId: scope.institutionId, actorUserId: scope.userId });
    if (result === 'linked') throw new StudentError(409, 'This student has opened an account, so they cannot be removed from the list. Correct their details instead.');
    if (result === 'missing') throw new StudentError(404, 'That student is not on a list you manage.');
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
