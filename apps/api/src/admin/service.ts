import type { AdministratorOverview } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { percent } from '../attendance/report.js';
import type { AdministratorOverviewRepository } from './repository.js';

export class AdministratorOverviewService {
  readonly #repository: AdministratorOverviewRepository;
  readonly #now: () => Date;

  constructor(options: { readonly repository: AdministratorOverviewRepository; readonly now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  getOverview(account: AdministratorSessionAccount): Promise<AdministratorOverview> {
    return this.#repository.getOverview(account, this.#now());
  }

  /**
   * Scope-filtered attendance health per course offering. Rates use the same
   * rule as the lecturer's course report: students still on the course or who
   * completed it count, those who left do not; a class that started before a
   * student joined is not expected of them unless they have a record for it;
   * removed records count as expected but not attended; and a class still
   * taking attendance counts only for students who already have a record.
   */
  async getAttendanceOverview(account: AdministratorSessionAccount) {
    const now = this.#now();
    const rows = await this.#repository.getAttendanceOfferings(account, now);
    const offerings = rows.map((row) => {
      const expectedCheckIns = row.absentPairs + row.countedRecords;
      return {
        courseOfferingId: row.courseOfferingId,
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
        departmentName: row.departmentName,
        semesterLabel: row.semesterLabel,
        sessionsHeld: row.sessionsHeld,
        activeEnrollments: row.activeEnrollments,
        completedEnrollments: row.completedEnrollments,
        expectedCheckIns,
        // The rate's numerator, so "present of expected" always matches the rate.
        presentCheckIns: row.presentCounted,
        inconclusiveCheckIns: row.inconclusive,
        manualCheckIns: row.manual,
        revokedCheckIns: row.revoked,
        rate: percent(row.presentCounted, expectedCheckIns),
        lastSessionAt: row.lastSessionAt,
        openDisputes: row.openDisputes,
        oldestOpenDisputeAt: row.oldestOpenDisputeAt,
      };
    });
    const sum = (pick: (row: (typeof offerings)[number]) => number) =>
      offerings.reduce((total, row) => total + pick(row), 0);
    return {
      generatedAt: now,
      totals: {
        offeringsWithSessions: offerings.filter((row) => row.sessionsHeld > 0).length,
        sessionsHeld: sum((row) => row.sessionsHeld),
        expectedCheckIns: sum((row) => row.expectedCheckIns),
        presentCheckIns: sum((row) => row.presentCheckIns),
        inconclusiveCheckIns: sum((row) => row.inconclusiveCheckIns),
        manualCheckIns: sum((row) => row.manualCheckIns),
        revokedCheckIns: sum((row) => row.revokedCheckIns),
        rate: percent(sum((row) => row.presentCheckIns), sum((row) => row.expectedCheckIns)),
        openDisputes: sum((row) => row.openDisputes),
        oldestOpenDisputeAt: rows.reduce<Date | null>(
          (oldest, row) => (row.oldestOpenDisputeAt && (!oldest || row.oldestOpenDisputeAt < oldest) ? row.oldestOpenDisputeAt : oldest),
          null,
        ),
      },
      offerings,
    };
  }
}
