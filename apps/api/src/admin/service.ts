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
    return this.#repository.getOverview(account);
  }

  /**
   * Scope-filtered attendance health per course offering. Rates use the same
   * rule as the lecturer report: sessions that started before a student
   * enrolled are not expected of them, revoked records do not count, and
   * withdrawn students are excluded from the rate.
   */
  async getAttendanceOverview(account: AdministratorSessionAccount) {
    const now = this.#now();
    const rows = await this.#repository.getAttendanceOfferings(account, now);
    const offerings = rows.map((row) => {
      const expectedCheckIns = row.expectedPairs + row.latePresentActive;
      return {
        courseOfferingId: row.courseOfferingId,
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
        departmentName: row.departmentName,
        semesterLabel: row.semesterLabel,
        sessionsHeld: row.sessionsHeld,
        activeEnrollments: row.activeEnrollments,
        expectedCheckIns,
        presentCheckIns: row.presentAll,
        inconclusiveCheckIns: row.inconclusive,
        manualCheckIns: row.manual,
        revokedCheckIns: row.revoked,
        rate: percent(row.presentActive, expectedCheckIns),
        lastSessionAt: row.lastSessionAt,
        openDisputes: row.openDisputes,
        oldestOpenDisputeAt: row.oldestOpenDisputeAt,
      };
    });
    const sum = (pick: (row: (typeof offerings)[number]) => number) =>
      offerings.reduce((total, row) => total + pick(row), 0);
    const presentActive = rows.reduce((total, row) => total + row.presentActive, 0);
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
        rate: percent(presentActive, sum((row) => row.expectedCheckIns)),
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
