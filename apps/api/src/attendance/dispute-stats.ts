import { and, count, eq, inArray, min } from 'drizzle-orm';
import { attendanceDisputes, type DatabaseClient } from '@lasuatos/database';

export interface OpenDisputeStats {
  readonly open: number;
  readonly oldest: Date | null;
}

/** Open-dispute counts per offering, used by reports and the administrator overview. */
export async function openDisputeStats(database: Pick<DatabaseClient, 'select'>, institutionId: string, courseOfferingIds: readonly string[]) {
  if (!courseOfferingIds.length) return new Map<string, OpenDisputeStats>();
  const rows = await database
    .select({
      courseOfferingId: attendanceDisputes.courseOfferingId,
      open: count(),
      oldest: min(attendanceDisputes.createdAt),
    })
    .from(attendanceDisputes)
    .where(and(
      eq(attendanceDisputes.institutionId, institutionId),
      inArray(attendanceDisputes.courseOfferingId, [...courseOfferingIds]),
      eq(attendanceDisputes.status, 'open'),
    ))
    .groupBy(attendanceDisputes.courseOfferingId);
  return new Map(rows.map((row) => [row.courseOfferingId, { open: Number(row.open), oldest: row.oldest ?? null }]));
}
