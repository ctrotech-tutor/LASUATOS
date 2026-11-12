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
  /** Started-session x active-enrollment pairs where the student was enrolled when it started. */
  readonly expectedPairs: number;
  /** Present records by actively enrolled students. */
  readonly presentActive: number;
  /** Present records by active students who enrolled after the session started (they count as expected too). */
  readonly latePresentActive: number;
  readonly presentAll: number;
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
