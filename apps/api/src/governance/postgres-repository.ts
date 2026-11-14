import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from '@lasuatos/database';
import type { AuditCategory, RetentionPolicy } from '@lasuatos/contracts';
import type {
  AuditFilter,
  AuditRow,
  AuditScope,
  GovernanceRepository,
  RetentionRunRecord,
  RetentionSetRow,
} from './repository.js';
import { ATTENDANCE_ACTIONS, FACE_ACTIONS } from './repository.js';


function list(values: readonly string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

/** Departments the scope covers (a subquery returning department ids). */
function scopeDepartments(scope: AuditScope): SQL {
  if (scope.type === 'department') return sql`select ${scope.departmentId}::uuid`;
  if (scope.type === 'faculty') return sql`select d.id from departments d where d.faculty_id = ${scope.facultyId}::uuid`;
  return sql`select d.id from departments d where d.institution_id = ${scope.institutionId}::uuid`;
}

/** The date a set's final session ends: 1 September of (set year + programme years). */
const FINISHED_ON = sql`make_date(e.entry_year + d.programme_years, 9, 1)`;

interface RawAudit extends Record<string, unknown> {
  id: string;
  source: AuditRow['source'];
  action: string;
  actor_name: string | null;
  subject_name: string | null;
  matric_number: string | null;
  target_label: string | null;
  details: string | null;
  created_at: Date | string;
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listAudit(scope: AuditScope, filter: AuditFilter): Promise<AuditRow[]> {
    const limited = scope.type !== 'institution';
    const departments = scopeDepartments(scope);
    const actor = limited ? scope.actorUserId : null;
    const wants = (category: AuditCategory) => !filter.category || filter.category === category;
    const branches: SQL[] = [];

    // Student events: class lists, accounts, faces, help requests, retention.
    const studentCategories: SQL[] = [];
    if (wants('faces')) studentCategories.push(sql`ev.action in (${list(FACE_ACTIONS)})`);
    if (wants('attendance')) studentCategories.push(sql`ev.action in (${list(ATTENDANCE_ACTIONS)})`);
    if (wants('retention') && !limited) studentCategories.push(sql`ev.action = 'retention_run'`);
    if (wants('students')) {
      studentCategories.push(sql`ev.action not in (${list([...FACE_ACTIONS, ...ATTENDANCE_ACTIONS, 'retention_run'])})`);
    }
    if (studentCategories.length > 0) {
      const inScope = limited
        ? sql`and (
            ev.actor_user_id = ${actor}::uuid
            or sp.department_id in (${departments})
            or exists (
              select 1 from class_list_entries ce
              where ce.institution_id = ev.institution_id and ce.matric_number = ev.matric_number and ce.department_id in (${departments})
            )
          )`
        : sql``;
      branches.push(sql`
        select 'student:' || ev.id as id, 'student' as source, ev.action::text as action,
          actor.display_name as actor_name, subject.display_name as subject_name, ev.matric_number,
          null::text as target_label, ev.details, ev.created_at
        from student_audit_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join users subject on subject.id = ev.subject_user_id
        left join student_profiles sp on sp.user_id = ev.subject_user_id
        where ev.institution_id = ${scope.institutionId}::uuid
          and (${sql.join(studentCategories, sql` or `)})
          ${inScope}
      `);
    }

    // Lecture attendance changed by hand: students added by the session taker, and removals.
    if (wants('attendance')) {
      const inScope = limited
        ? sql`and (s.department_id in (${departments})${scope.type === 'faculty' ? sql` or s.faculty_id = ${scope.facultyId}::uuid` : sql``})`
        : sql``;
      branches.push(sql`
        select 'manual:' || a.id, 'student', 'attendee_added_by_hand',
          adder.display_name, a.full_name, a.matric_number,
          s.course_code || ' · ' || to_char(s.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY'),
          coalesce('venue=' || a.venue_outcome, ''), a.created_at
        from lecture_attendance a
        join lecture_sessions s on s.id = a.lecture_session_id
        left join users adder on adder.id = a.added_by_user_id
        where a.institution_id = ${scope.institutionId}::uuid and a.method = 'manual' ${inScope}
      `);
      branches.push(sql`
        select 'removal:' || a.id, 'student', 'attendee_removed',
          remover.display_name, a.full_name, a.matric_number,
          s.course_code || ' · ' || to_char(s.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY'),
          coalesce('reason=' || a.removed_reason, ''), a.removed_at
        from lecture_attendance a
        join lecture_sessions s on s.id = a.lecture_session_id
        left join users remover on remover.id = a.removed_by_user_id
        where a.institution_id = ${scope.institutionId}::uuid and a.removed_at is not null ${inScope}
      `);
    }

    // Staff invitations and accounts.
    if (wants('staff')) {
      const inScope = limited
        ? sql`and (
            ev.actor_user_id = ${actor}::uuid
            or exists (select 1 from lecturer_profiles lp where lp.user_id = ev.target_user_id and lp.department_id in (${departments}))
          )`
        : sql``;
      branches.push(sql`
        select 'staff:' || ev.id, 'staff', ev.action::text,
          actor.display_name, coalesce(target.display_name, inv.display_name, inv.email), null,
          null, coalesce('reason=' || ev.reason, ''), ev.created_at
        from staff_audit_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join users target on target.id = ev.target_user_id
        left join staff_invitations inv on inv.id = ev.invitation_id
        where ev.institution_id = ${scope.institutionId}::uuid ${inScope}
      `);
    }

    // Faculties, departments, sessions (structure) and buildings or venues (venues).
    const structureTypes: string[] = [];
    if (wants('structure')) structureTypes.push('faculty', 'department', 'academic_session');
    if (wants('venues')) structureTypes.push('building', 'venue');
    if (structureTypes.length > 0) {
      const inScope = limited
        ? sql`and (
            ev.actor_user_id = ${actor}::uuid
            or (ev.target_type = 'department' and ev.target_id in (${departments}))
            ${scope.type === 'faculty' ? sql`or (ev.target_type = 'faculty' and ev.target_id = ${scope.facultyId}::uuid)` : sql``}
          )`
        : sql``;
      branches.push(sql`
        select 'structure:' || ev.id, 'structure', ev.action::text,
          actor.display_name, null, null,
          coalesce(f.name, dep.name, sess.code, b.name, v.name),
          ev.details, ev.created_at
        from structure_audit_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join faculties f on ev.target_type = 'faculty' and f.id = ev.target_id
        left join departments dep on ev.target_type = 'department' and dep.id = ev.target_id
        left join academic_sessions sess on ev.target_type = 'academic_session' and sess.id = ev.target_id
        left join buildings b on ev.target_type = 'building' and b.id = ev.target_id
        left join venues v on ev.target_type = 'venue' and v.id = ev.target_id
        where ev.institution_id = ${scope.institutionId}::uuid and ev.target_type in (${list(structureTypes)}) ${inScope}
      `);
    }
    if (wants('venues')) {
      const inScope = limited ? sql`and ev.actor_user_id = ${actor}::uuid` : sql``;
      branches.push(sql`
        select 'venue:' || ev.id, 'venue', 'venue_location_' || ev.kind::text,
          actor.display_name, null, null, v.name,
          concat_ws(' ',
            case when ev.reported_accuracy_meters is not null then 'accuracy_m=' || round(ev.reported_accuracy_meters)::text end,
            case when ev.geofence_radius_meters is not null then 'radius_m=' || ev.geofence_radius_meters::text end,
            case when ev.sample_count is not null then 'samples=' || ev.sample_count::text end),
          ev.created_at
        from venue_location_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join venues v on v.id = ev.venue_id
        where ev.institution_id = ${scope.institutionId}::uuid ${inScope}
      `);
    }
    if (branches.length === 0) return [];

    const conditions: SQL[] = [];
    if (filter.from) conditions.push(sql`u.created_at >= ${filter.from.toISOString()}::timestamptz`);
    if (filter.to) conditions.push(sql`u.created_at < ${filter.to.toISOString()}::timestamptz`);
    if (filter.before) {
      conditions.push(sql`(u.created_at, u.id) < (${filter.before.at.toISOString()}::timestamptz, ${filter.before.id})`);
    }
    if (filter.query) {
      const pattern = `%${filter.query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      const digits = filter.query.replace(/\D/g, '');
      conditions.push(sql`(
        u.actor_name ilike ${pattern} or u.subject_name ilike ${pattern} or u.target_label ilike ${pattern}
        ${digits.length >= 4 ? sql`or u.matric_number like ${`%${digits}%`}` : sql``}
      )`);
    }
    const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
    const result = await this.database.execute<RawAudit>(sql`
      select * from (
        ${sql.join(branches, sql` union all `)}
      ) as u (id, source, action, actor_name, subject_name, matric_number, target_label, details, created_at)
      ${where}
      order by u.created_at desc, u.id desc
      limit ${filter.limit}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      source: row.id.startsWith('venue:') ? 'venue' : row.source,
      action: row.action,
      actorName: row.actor_name,
      subjectName: row.subject_name,
      matricNumber: row.matric_number,
      targetLabel: row.target_label,
      details: row.details ?? '',
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }));
  }

  #activeSince(policy: RetentionPolicy, now: Date): string {
    return new Date(now.getTime() - policy.activeWithinDays * 86_400_000).toISOString();
  }

  /** Users whose face data is due under the policy (a subquery returning user ids). */
  #dueUsers(institutionId: string, policy: RetentionPolicy, now: Date): SQL {
    return sql`
      select e.student_user_id
      from class_list_entries e
      join departments d on d.id = e.department_id
      where e.institution_id = ${institutionId}::uuid
        and e.student_user_id is not null
        and ${FINISHED_ON} + make_interval(months => ${policy.graceMonths}::int) <= ${now.toISOString()}::timestamptz
        and not exists (
          select 1 from lecture_attendance a
          where a.student_user_id = e.student_user_id and a.removed_at is null
            and a.created_at > ${this.#activeSince(policy, now)}::timestamptz
        )
    `;
  }

  async listFinishedSets(institutionId: string, policy: RetentionPolicy, now: Date): Promise<RetentionSetRow[]> {
    const result = await this.database.execute<{
      department_name: string; entry_year: number; programme_years: number;
      students: number; faces: number; due_faces: number; kept_active: number;
    }>(sql`
      select d.name as department_name, e.entry_year::int as entry_year, d.programme_years::int as programme_years,
        count(*)::int as students,
        count(f.user_id)::int as faces,
        count(f.user_id) filter (where due.is_due and not act.active)::int as due_faces,
        count(f.user_id) filter (where due.is_due and act.active)::int as kept_active
      from class_list_entries e
      join departments d on d.id = e.department_id
      left join student_face_profiles f on f.user_id = e.student_user_id
      cross join lateral (
        select (${FINISHED_ON} + make_interval(months => ${policy.graceMonths}::int) <= ${now.toISOString()}::timestamptz) as is_due
      ) due
      cross join lateral (
        select exists (
          select 1 from lecture_attendance a
          where e.student_user_id is not null and a.student_user_id = e.student_user_id and a.removed_at is null
            and a.created_at > ${this.#activeSince(policy, now)}::timestamptz
        ) as active
      ) act
      where e.institution_id = ${institutionId}::uuid
        and ${FINISHED_ON} <= ${now.toISOString()}::timestamptz
      group by d.name, e.entry_year, d.programme_years
      order by e.entry_year asc, d.name asc
      limit 2000
    `);
    return result.rows.map((row) => ({
      departmentName: row.department_name,
      entryYear: Number(row.entry_year),
      programmeYears: Number(row.programme_years),
      students: Number(row.students),
      faces: Number(row.faces),
      dueFaces: Number(row.due_faces),
      keptActive: Number(row.kept_active),
    }));
  }

  async countDueCheckPhotos(institutionId: string, policy: RetentionPolicy, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - policy.checkPhotoDays * 86_400_000).toISOString();
    const result = await this.database.execute<{ count: number }>(sql`
      select count(*)::int as count from lecture_face_checks c
      where c.institution_id = ${institutionId}::uuid and c.photo is not null
        and (c.created_at < ${cutoff}::timestamptz or c.student_user_id in (${this.#dueUsers(institutionId, policy, now)}))
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async lastRetentionRun(institutionId: string): Promise<RetentionRunRecord | null> {
    const result = await this.database.execute<{ created_at: Date | string; actor_name: string | null; details: string }>(sql`
      select ev.created_at, actor.display_name as actor_name, ev.details
      from student_audit_events ev
      left join users actor on actor.id = ev.actor_user_id
      where ev.institution_id = ${institutionId}::uuid and ev.action = 'retention_run' and ev.subject_user_id is null
      order by ev.created_at desc
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return { at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at), actorName: row.actor_name, details: row.details };
  }

  async runRetention(input: {
    readonly institutionId: string;
    readonly policy: RetentionPolicy;
    readonly now: Date;
    readonly actorUserId: string | null;
  }): Promise<{ readonly facesDeleted: number; readonly checkPhotosDeleted: number }> {
    const { institutionId, policy, now } = input;
    const cutoff = new Date(now.getTime() - policy.checkPhotoDays * 86_400_000).toISOString();
    return this.database.transaction(async (tx) => {
      // Lock out a second run (cron and a button press) until this one commits.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lasuatos_retention'), hashtext(${institutionId}))`);
      const photos = await tx.execute<{ count: number }>(sql`
        with cleared as (
          update lecture_face_checks c set photo = null
          where c.institution_id = ${institutionId}::uuid and c.photo is not null
            and (c.created_at < ${cutoff}::timestamptz or c.student_user_id in (${this.#dueUsers(institutionId, policy, now)}))
          returning 1
        )
        select count(*)::int as count from cleared
      `);
      const deleted = await tx.execute<{ user_id: string; matric_number: string | null; set_year: number | null }>(sql`
        with gone as (
          delete from student_face_profiles f
          where f.institution_id = ${institutionId}::uuid and f.user_id in (${this.#dueUsers(institutionId, policy, now)})
          returning f.user_id
        )
        select gone.user_id, e.matric_number, e.entry_year::int as set_year
        from gone
        left join lateral (
          select ce.matric_number, ce.entry_year from class_list_entries ce
          where ce.student_user_id = gone.user_id order by ce.entry_year desc limit 1
        ) e on true
      `);
      const nowIso = now.toISOString();
      for (const row of deleted.rows) {
        await tx.execute(sql`
          insert into student_audit_events (institution_id, actor_user_id, action, subject_user_id, matric_number, details, created_at)
          values (${institutionId}::uuid, ${input.actorUserId}::uuid, 'retention_run', ${row.user_id}::uuid, ${row.matric_number},
            ${`face_deleted set=${row.set_year ?? 'unknown'} grace_months=${policy.graceMonths}`}, ${nowIso}::timestamptz)
        `);
      }
      const facesDeleted = deleted.rows.length;
      const checkPhotosDeleted = Number(photos.rows[0]?.count ?? 0);
      await tx.execute(sql`
        insert into student_audit_events (institution_id, actor_user_id, action, subject_user_id, matric_number, details, created_at)
        values (${institutionId}::uuid, ${input.actorUserId}::uuid, 'retention_run', null, null,
          ${`faces=${facesDeleted} check_photos=${checkPhotosDeleted} scheduled=${input.actorUserId === null} grace_months=${policy.graceMonths} active_days=${policy.activeWithinDays} photo_days=${policy.checkPhotoDays}`},
          ${nowIso}::timestamptz)
      `);
      return { facesDeleted, checkPhotosDeleted };
    });
  }

  async listInstitutionIds(): Promise<string[]> {
    const result = await this.database.execute<{ id: string }>(sql`select id from institutions order by created_at asc`);
    return result.rows.map((row) => row.id);
  }
}
