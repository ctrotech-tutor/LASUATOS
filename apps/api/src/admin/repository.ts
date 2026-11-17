import type { AdministratorOverview } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';

/** Per-offering attendance aggregates inside the administrator's scope. */
export interface AdministratorAttendanceOfferingRow {
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly departmentName: string;
  readonly semesterLabel: string;
  readonly sessionsHeld: number;
  readonly lastSessionAt: Date | null;
  readonly activeEnrollments: number;
  /** Students who finished the course when its semester ended; they still count. */
  readonly completedEnrollments: number;
  /**
   * Classes counted students missed: on the course when it started, no record, and over (a class
   * still taking attendance is not a miss yet).
   */
  readonly absentPairs: number;
  /** Records (present or removed) of counted students: each is a class expected of them. */
  readonly countedRecords: number;
  /** Present records of counted students. */
  readonly presentCounted: number;
  readonly inconclusive: number;
  readonly manual: number;
  readonly revoked: number;
  /** Student disputes awaiting a lecturer decision. */
  readonly openDisputes: number;
  readonly oldestOpenDisputeAt: Date | null;
}

export interface AdministratorOverviewRepository {
  getOverview(account: AdministratorSessionAccount, now: Date): Promise<AdministratorOverview>;
  getAttendanceOfferings(account: AdministratorSessionAccount, now: Date): Promise<AdministratorAttendanceOfferingRow[]>;
}
