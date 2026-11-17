export interface ClassListRecord {
  readonly id: string;
  readonly institutionId: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly facultyId: string;
  readonly facultyName: string;
  /** The department's normal programme length in years (caps the level). */
  readonly programmeYears: number;
  /** The number the student is known by: their matric number, or their JAMB number until it arrives. */
  readonly matricNumber: string;
  /** Their JAMB registration number when the list had it (kept after the matric number arrives). */
  readonly jambNumber: string | null;
  /** The account was opened while on a JAMB number: its personal email proves who they are. */
  readonly jambJoined: boolean;
  readonly surname: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lasuEmail: string | null;
  readonly entryYear: number;
  readonly entryLevel: 100 | 200 | 300;
  readonly studentUserId: string | null;
  /**
   * The linked account's email and whether it is confirmed proof of the
   * student: a LASU address, or a personal one for a student who joined on a
   * JAMB number (see isStudentProofEmail).
   */
  readonly accountEmail: string | null;
  readonly accountEmailVerified: boolean;
  /** The account was opened with the HOC's setup code (and its email is not confirmed yet). */
  readonly accountVouched: boolean;
  readonly accountPasswordIsDefault: boolean;
  readonly faceRegistered: boolean;
  readonly isRep: boolean;
  readonly addedByName: string | null;
  readonly updatedAt: Date;
}

export interface DepartmentRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly facultyId: string;
  readonly facultyName: string;
}

/** Raw counts for one list; `confirmed` means a LASU email proven with a code. */
export interface ClassListSummaryRecord {
  readonly departmentId: string;
  readonly entryYear: number;
  readonly total: number;
  readonly opened: number;
  readonly confirmed: number;
  readonly confirmedWithFace: number;
  readonly updatedAt: Date;
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
    /** Set for an assistant (AHOC, AGHOC). */
    readonly assistantOfId?: string | null;
    /** An assistant's extra powers: `class_list`, `setup_codes`, … */
    readonly permissions?: readonly string[];
  } | null;
}

export interface ClassListRowWrite {
  readonly matricNumber: string;
  /** The JAMB number (the same as matricNumber for a student without a matric number yet). */
  readonly jambNumber?: string | null | undefined;
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
  /** Students on a JAMB number switched to the matric number in the upload. */
  readonly switched: number;
}

/** A student moved from their JAMB number to their matric number. */
export interface NumberSwitchOutcome {
  readonly attendanceMoved: number;
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
  /** An older account whose LASU email was never confirmed was handed to the student. */
  | { readonly kind: 'taken_over'; readonly userId: string; readonly previousEmail: string }
  /** An account with a confirmed LASU email already has this entry: sign in. */
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
  /** Counts per list (department and set) for the given departments, optionally one set only. */
  summarizeLists(institutionId: string, departmentIds: readonly string[], entryYear: number | null): Promise<ClassListSummaryRecord[]>;
  /** Existing entries with these matric numbers anywhere in the institution. */
  findEntriesByMatric(institutionId: string, matricNumbers: readonly string[]): Promise<ClassListRecord[]>;
  /** Existing entries with these JAMB numbers (on them now, or before their matric number arrived). */
  findEntriesByJamb(institutionId: string, jambNumbers: readonly string[]): Promise<ClassListRecord[]>;
  /**
   * A student on a JAMB number adds their matric number and LASU email (proved
   * with a code): the entry, account, profile and every attendance record
   * switch to the matric number; `mergeEntryId` is an unlinked entry the HOC
   * had already added for that matric number, which is folded into this one.
   */
  switchToMatric(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly userId: string;
    readonly matricNumber: string;
    readonly email: string;
    readonly mergeEntryId: string | null;
    readonly now: Date;
  }): Promise<({ readonly kind: 'switched' } & NumberSwitchOutcome) | { readonly kind: 'changed' | 'matric_taken' | 'email_taken' }>;
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
  /**
   * Moves a student to another department's list for the same set: the entry and the
   * account's profile both change department; the account, attendance and face stay.
   */
  moveEntry(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly departmentId: string;
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<'moved' | 'unchanged' | 'is_rep' | 'missing'>;
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
  /**
   * Opens the entry's account, or takes over an older account linked to it
   * (or using its matric number) whose LASU email was never confirmed: the
   * email switches, the password goes back to the starting password, every
   * session and reset link is cancelled and any registered face is deleted;
   * attendance stays.
   */
  openAccount(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly email: string;
    /** False when opened with a HOC's setup code: the email is confirmed later. */
    readonly emailVerified: boolean;
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
    /** Who vouched for the student (the HOC who gave a setup code); null for an emailed code. */
    readonly vouchedByUserId: string | null;
    /** The entry is on a JAMB number, so `email` is a personal address that proves who they are. */
    readonly jamb?: boolean | undefined;
  }): Promise<OpenAccountResult>;
  /** A student with a confirmed LASU email chose a new password with an emailed code. */
  resetPasswordWithCode(input: {
    readonly userId: string;
    readonly institutionId: string;
    readonly matricNumber: string;
    readonly passwordHash: string;
    readonly sessionTokenHash: string;
    readonly sessionExpiresAt: Date;
    readonly now: Date;
  }): Promise<{ readonly kind: 'reset'; readonly signedOutSessions: number } | { readonly kind: 'missing' }>;
  /** Stores a HOC's setup code for an entry, replacing any earlier one. */
  issueSetupCode(input: {
    readonly entryId: string;
    readonly codeHash: string;
    readonly issuedByUserId: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<void>;
  /** Checks a setup code; a right one is spent straight away (it works once). */
  useSetupCode(input: {
    readonly entryId: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly maxAttempts: number;
  }): Promise<{ readonly kind: 'ok'; readonly issuedByUserId: string } | { readonly kind: 'wrong'; readonly attemptsLeft: number } | { readonly kind: 'expired' } | { readonly kind: 'missing' }>;
  /**
   * Administrators: takes a confirmed account away from whoever confirmed it.
   * The account is left unconfirmed with no usable password, every way back in
   * is closed (sessions, reset links, pending codes), the face is deleted and
   * the corrected LASU email goes on the list. Attendance stays with it.
   */
  releaseAccount(input: {
    readonly entryId: string;
    readonly institutionId: string;
    readonly listEmail: string;
    readonly unusablePasswordHash: string;
    readonly actorUserId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<
    | { readonly kind: 'released'; readonly userId: string; readonly previousEmail: string; readonly signedOutSessions: number; readonly faceDeleted: boolean }
    | { readonly kind: 'missing' | 'not_proven' | 'same_email' | 'email_taken' }
  >;
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
