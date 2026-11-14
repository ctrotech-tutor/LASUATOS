export interface ClassListRecord {
  readonly id: string;
  readonly institutionId: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly facultyId: string;
  readonly facultyName: string;
  /** The department's normal programme length in years (caps the level). */
  readonly programmeYears: number;
  readonly matricNumber: string;
  readonly surname: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lasuEmail: string | null;
  readonly entryYear: number;
  readonly entryLevel: 100 | 200 | 300;
  readonly studentUserId: string | null;
  /** The linked account's email and whether it is a confirmed LASU address. */
  readonly accountEmail: string | null;
  readonly accountEmailVerified: boolean;
  readonly accountPasswordIsDefault: boolean;
  readonly faceRegistered: boolean;
  readonly isRep: boolean;
  readonly addedByName: string | null;
  readonly updatedAt: Date;
}

export interface DepartmentRecord {
  readonly id: string;
  readonly name: string;
  readonly facultyId: string;
  readonly facultyName: string;
}

/** Who is asking to manage class lists. */
export interface ClassListActor {
  readonly userId: string;
  readonly institutionId: string;
  readonly classRep: {
    readonly role: 'hoc' | 'ghoc';
    readonly facultyId: string;
    readonly departmentId: string | null;
    readonly entryYear: number;
  } | null;
}

export interface ClassListRowWrite {
  readonly matricNumber: string;
  readonly surname: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lasuEmail: string | null;
  readonly entryLevel: 100 | 200 | 300;
}

export type ImportRowOutcome = 'added' | 'updated' | 'unchanged';

export interface ImportOutcome {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly linked: number;
}

export interface StudentAuditWrite {
  readonly institutionId: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly subjectUserId?: string | null | undefined;
  readonly matricNumber?: string | null | undefined;
  readonly details?: string | undefined;
}

export interface StudentAuditRecord {
  readonly id: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly matricNumber: string | null;
  readonly details: string;
  readonly createdAt: Date;
}

export type EmailCodeIssue =
  | { readonly kind: 'issued' }
  | { readonly kind: 'cooldown'; readonly retryAfterSeconds: number }
  | { readonly kind: 'daily_cap' };

export type EmailCodeCheck =
  | { readonly kind: 'ok'; readonly email: string }
  | { readonly kind: 'wrong'; readonly attemptsLeft: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'missing' };

export type OpenAccountResult =
  | { readonly kind: 'created'; readonly userId: string }
  | { readonly kind: 'claimed' }
  | { readonly kind: 'email_taken' }
  | { readonly kind: 'matric_taken' };

export interface FaceProfileRecord {
  readonly userId: string;
  readonly model: string;
  readonly templates: number[][];
  readonly enrolledAt: Date;
  /** Set while the student may replace it (confirmed with password and emailed code). */
  readonly replaceAllowedUntil?: Date | null | undefined;
}

export interface FaceProfileWrite {
  readonly userId: string;
  readonly institutionId: string;
  readonly model: string;
  readonly templates: number[][];
  readonly centroid: number[];
  readonly photo: Buffer;
  readonly quality: Record<string, number>;
  readonly consentedAt: Date;
  readonly now: Date;
}

export interface FaceCheckWrite {
  readonly institutionId: string;
  readonly lectureSessionId: string;
  readonly studentUserId: string;
  readonly score: number;
  readonly real: number;
  readonly live: number;
  readonly needsReview: boolean;
  readonly photo: Buffer | null;
  readonly now: Date;
}

/** A signed-in student account's identity, for setup. */
export interface StudentAccountRecord {
  readonly userId: string;
  readonly institutionId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly matricNumber: string;
  readonly passwordIsDefault: boolean;
}

export interface StudentRepository {
  findInstitutionId(slug: string): Promise<string | null>;
  findEntryByMatric(institutionId: string, matricNumber: string): Promise<ClassListRecord | null>;
  findEntryById(institutionId: string, entryId: string): Promise<ClassListRecord | null>;
  findEntryByUser(userId: string): Promise<ClassListRecord | null>;
  findStudentAccount(userId: string): Promise<StudentAccountRecord | null>;
  /** True when any account (other than `exceptUserId`) or another class-list entry uses this address. */
  emailInUse(institutionId: string, email: string, options: { readonly exceptUserId?: string | null; readonly exceptEntryId?: string | null }): Promise<boolean>;
  /** The student account (not closed) with this matric number, if any. */
  findStudentUserByMatric(institutionId: string, matricNumber: string): Promise<string | null>;

  findClassListActor(userId: string): Promise<ClassListActor | null>;
  listDepartments(institutionId: string): Promise<DepartmentRecord[]>;
  listEntries(institutionId: string, departmentId: string, entryYear: number | null): Promise<ClassListRecord[]>;
  /** Existing entries with these matric numbers anywhere in the institution. */
  findEntriesByMatric(institutionId: string, matricNumbers: readonly string[]): Promise<ClassListRecord[]>;
  /**
   * Adds or updates rows (matched by matric number) in one transaction, links
   * each to an existing student account with the same matric number, copies
   * the list's name onto linked accounts and writes the audit trail.
   */
  importEntries(input: {
    readonly institutionId: string;
    readonly departmentId: string;
    readonly entryYear: number;
    readonly rows: readonly ClassListRowWrite[];
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<ImportOutcome>;
  updateEntry(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly changes: Partial<ClassListRowWrite>;
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<'updated' | 'matric_taken' | 'email_taken' | 'missing'>;
  /** Removes an entry no account has been opened from. */
  removeEntry(input: { readonly entryId: string; readonly institutionId: string; readonly actorUserId: string }): Promise<'removed' | 'linked' | 'missing'>;
  /** Events about these students, plus uploads and removals on this department's list (and set). */
  listAudit(institutionId: string, scope: { readonly matricNumbers: readonly string[]; readonly departmentId: string; readonly entryYear: number | null }, limit: number): Promise<StudentAuditRecord[]>;
  audit(event: StudentAuditWrite): Promise<void>;

  issueEmailCode(input: {
    readonly entryId: string;
    readonly email: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly cooldownSeconds: number;
    readonly dailyCap: number;
  }): Promise<EmailCodeIssue>;
  /** Checks a code; a wrong guess counts, the fifth spends the code; a right one deletes it. */
  checkEmailCode(input: {
    readonly entryId: string;
    readonly hashFor: (email: string) => string;
    readonly now: Date;
    readonly maxAttempts: number;
  }): Promise<EmailCodeCheck>;
  /** Opens an account from a class-list entry and starts its first session. */
  openAccount(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
  }): Promise<OpenAccountResult>;
  /** An existing student account adopts its class-list entry and confirmed LASU address. */
  confirmAccountEmail(input: {
    readonly userId: string;
    readonly entryId: string;
    readonly email: string;
    readonly now: Date;
  }): Promise<'updated' | 'email_taken' | 'claimed'>;

  findFaceProfile(userId: string): Promise<FaceProfileRecord | null>;
  findFacePhoto(userId: string): Promise<Buffer | null>;
  listFaceCentroids(institutionId: string, exceptUserId: string): Promise<Array<{ readonly userId: string; readonly centroid: number[] }>>;
  /** 'exists' when the student already has a registered face. */
  saveFaceProfile(input: FaceProfileWrite): Promise<'saved' | 'exists'>;
  deleteFaceProfile(userId: string): Promise<boolean>;
  saveFaceCheck(input: FaceCheckWrite): Promise<void>;
  /** Failed face checks of this student for this lecture since `since` (from the audit trail). */
  countFaceFailures(userId: string, lectureSessionId: string, since: Date): Promise<number>;
  /** As countFaceFailures, with the reason of the latest failure (e.g. "mismatch"). */
  faceFailures(userId: string, lectureSessionId: string, since: Date): Promise<{ readonly count: number; readonly lastReason: string | null }>;
  /** Events with this action about this student since `since`. */
  countAudit(subjectUserId: string, action: string, since: Date): Promise<number>;
  /** Lets the student replace their face until `until`; false when none is registered. */
  allowFaceReplacement(userId: string, until: Date): Promise<boolean>;
  /**
   * Replaces the registered face in place (the old signatures and portrait are
   * overwritten) when replacement is still allowed at `input.now`.
   */
  replaceFaceProfile(input: FaceProfileWrite): Promise<'replaced' | 'not_allowed'>;
  /**
   * Who already uses these LASU addresses: class-list entries (by matric
   * number) and student accounts (by their matric number, or null).
   */
  findEmailOwners(institutionId: string, emails: readonly string[]): Promise<Array<{ readonly email: string; readonly matricNumber: string | null }>>;
  findFaceCheckPhoto(lectureSessionId: string, studentUserId: string): Promise<Buffer | null>;
}
