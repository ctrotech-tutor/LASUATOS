import { and, count, countDistinct, eq, isNotNull } from 'drizzle-orm';
import {
  courseEnrollments,
  courseOfferings,
  departments,
  lecturerProfiles,
  studentProfiles,
  userRoleAssignments,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { AdministratorOverviewRepository } from './repository.js';

function departmentScope(account: AdministratorSessionAccount) {
  if (account.scope.type === 'department') return eq(departments.id, account.scope.id);
  if (account.scope.type === 'faculty') return eq(departments.facultyId, account.scope.id);
  return undefined;
}

function accountRoleScope(account: AdministratorSessionAccount, role: 'student' | 'lecturer') {
  return and(
    eq(userRoleAssignments.role, role),
    eq(userRoleAssignments.institutionId, account.institutionId),
  );
}

export class PostgresAdministratorOverviewRepository implements AdministratorOverviewRepository {
  constructor(private readonly database: DatabaseClient) {}

  async getOverview(account: AdministratorSessionAccount) {
    const scope = departmentScope(account);
    const [departmentCount, studentCount, lecturerCount, offeringCount, enrollmentCount] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(departments)
        .where(and(
          eq(departments.institutionId, account.institutionId),
          eq(departments.isActive, true),
          scope,
        )),
      this.database
        .select({ value: countDistinct(studentProfiles.userId) })
        .from(studentProfiles)
        .innerJoin(users, eq(users.id, studentProfiles.userId))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          accountRoleScope(account, 'student'),
        ))
        .leftJoin(departments, and(
          eq(departments.id, studentProfiles.departmentId),
          eq(departments.institutionId, studentProfiles.institutionId),
        ))
        .where(and(
          eq(studentProfiles.institutionId, account.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          scope,
        )),
      this.database
        .select({ value: countDistinct(lecturerProfiles.userId) })
        .from(lecturerProfiles)
        .innerJoin(users, eq(users.id, lecturerProfiles.userId))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          accountRoleScope(account, 'lecturer'),
        ))
        .innerJoin(departments, and(
          eq(departments.id, lecturerProfiles.departmentId),
          eq(departments.institutionId, lecturerProfiles.institutionId),
        ))
        .where(and(
          eq(lecturerProfiles.institutionId, account.institutionId),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
          scope,
        )),
      this.database
        .select({ value: count() })
        .from(courseOfferings)
        .innerJoin(departments, and(
          eq(departments.id, courseOfferings.departmentId),
          eq(departments.institutionId, courseOfferings.institutionId),
        ))
        .where(and(
          eq(courseOfferings.institutionId, account.institutionId),
          scope,
        )),
      this.database
        .select({ value: count() })
        .from(courseEnrollments)
        .innerJoin(courseOfferings, and(
          eq(courseOfferings.id, courseEnrollments.courseOfferingId),
          eq(courseOfferings.institutionId, courseEnrollments.institutionId),
        ))
        .innerJoin(departments, and(
          eq(departments.id, courseOfferings.departmentId),
          eq(departments.institutionId, courseOfferings.institutionId),
        ))
        .where(and(
          eq(courseEnrollments.institutionId, account.institutionId),
          eq(courseEnrollments.status, 'active'),
          scope,
        )),
    ]);

    return {
      metrics: {
        departments: departmentCount[0]?.value ?? 0,
        activeStudents: studentCount[0]?.value ?? 0,
        activeLecturers: lecturerCount[0]?.value ?? 0,
        courseOfferings: offeringCount[0]?.value ?? 0,
        activeEnrollments: enrollmentCount[0]?.value ?? 0,
      },
    };
  }
}
