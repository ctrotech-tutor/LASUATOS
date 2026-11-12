import {
  academicSessionStartYear,
  deriveStudentLevel,
  type StudentLevel,
} from '@lasuatos/contracts';
import { academicSessions, type DatabaseClient } from '@lasuatos/database';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

/**
 * Server-side glue for the level derived from a student's matric number (see
 * `deriveStudentLevel` in @lasuatos/contracts for the rules). The level is
 * computed on read — never stored — because it changes every session.
 */

type Executor = Pick<DatabaseClient, 'select'>;

export interface StudentLevelInputs {
  readonly studentNumber: string;
  readonly entryYear: number | null;
  readonly entryLevel: number | null;
  readonly programmeYears: number | null;
}

/**
 * First year of the institution's current academic session: the session
 * flagged current, else the one containing `now`, else the September rule.
 */
export async function currentSessionStartYear(
  executor: Executor,
  institutionId: string,
  now: Date,
): Promise<number> {
  const [flagged] = await executor
    .select({ code: academicSessions.code, startsAt: academicSessions.startsAt })
    .from(academicSessions)
    .where(and(eq(academicSessions.institutionId, institutionId), eq(academicSessions.isCurrent, true)))
    .limit(1);
  if (flagged) return academicSessionStartYear({ code: flagged.code, startsAt: flagged.startsAt, now });
  const [containing] = await executor
    .select({ code: academicSessions.code, startsAt: academicSessions.startsAt })
    .from(academicSessions)
    .where(and(
      eq(academicSessions.institutionId, institutionId),
      lte(academicSessions.startsAt, now),
      gte(academicSessions.endsAt, now),
    ))
    .orderBy(desc(academicSessions.startsAt))
    .limit(1);
  if (containing) return academicSessionStartYear({ code: containing.code, startsAt: containing.startsAt, now });
  return academicSessionStartYear({ now });
}

export function studentLevelFor(inputs: StudentLevelInputs, sessionStartYear: number): StudentLevel {
  return deriveStudentLevel({
    matricNumber: inputs.studentNumber,
    entryYear: inputs.entryYear,
    entryLevel: inputs.entryLevel,
    programmeYears: inputs.programmeYears,
    sessionStartYear,
  });
}
