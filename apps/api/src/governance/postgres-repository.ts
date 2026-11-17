import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from '@lasuatos/database';
import { AUDIT_NOTABLE_ACTIONS, type AuditCategory, type RetentionPolicy } from '@lasuatos/contracts';
import type {
  AuditCounts,
  AuditFilter,
  AuditReferences,
  AuditRow,
  AuditScope,
  GovernanceRepository,
  RetentionHolding,
  RetentionRunRecord,
  RetentionSetRow,
  RetentionSetStudents,
} from './repository.js';
import { ATTENDANCE_ACTIONS, FACE_ACTIONS } from './repository.js';

function list(values: readonly string[]): SQL {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function uuidList(values: readonly string[]): SQL {
  return sql.join(values.map((value) => sql`${value}::uuid`), sql`, `);
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
  actor_id: string | null;
  actor_name: string | null;
  subject_name: string | null;
  matric_number: string | null;
  target_label: string | null;
  target_type: string | null;
  target_code: string | null;
  session_id: string | null;
  class_department_code: string | null;
  class_entry_year: number | string | null;
  staff_email: string | null;
  staff_role: string | null;
  staff_area: string | null;
  details: string | null;
  created_at: Date | string;
}

const COLUMNS = sql.raw(`id, source, action, actor_id, actor_name, subject_name, matric_number, target_label, target_type, target_code,
  session_id, class_department_code, class_entry_year, staff_email, staff_role, staff_area, details, created_at`);

/** Where a matric number sits on a class list (newest set first), for a link to the student. */
const CLASS_PLACE = (institution: SQL, matric: SQL) => sql`
  left join lateral (
    select cd.code as department_code, ce.entry_year
    from class_list_entries ce join departments cd on cd.id = ce.department_id
    where ce.institution_id = ${institution} and ce.matric_number = ${matric}
    order by ce.entry_year desc limit 1
  ) place on true`;

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly database: DatabaseClient) {}

  /**
   * Every audit trail the scope may see, as one relation with the same columns. Department and
   * faculty administrators see their area's student events, and the staff and structure changes
   * they made; institution administrators see everything.
   */
  #source(scope: AuditScope, category: AuditCategory | undefined): SQL | null {
    const limited = scope.type !== 'institution';
    const departments = scopeDepartments(scope);
    const actor = limited ? scope.actorUserId : null;
    const wants = (wanted: AuditCategory) => !category || category === wanted;
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
          ev.actor_user_id as actor_id, actor.display_name as actor_name, subject.display_name as subject_name, ev.matric_number,
          null::text as target_label, null::text as target_type, null::text as target_code, null::uuid as session_id,
          place.department_code as class_department_code, place.entry_year::int as class_entry_year,
          null::text as staff_email, null::text as staff_role, null::text as staff_area,
          ev.details, ev.created_at
        from student_audit_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join users subject on subject.id = ev.subject_user_id
        left join student_profiles sp on sp.user_id = ev.subject_user_id
        ${CLASS_PLACE(sql`ev.institution_id`, sql`ev.matric_number`)}
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
          a.added_by_user_id, adder.display_name, a.full_name, a.matric_number,
          s.course_code || ' · ' || to_char(s.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY'), 'lecture', s.course_code, s.id,
          place.department_code, place.entry_year::int, null, null, null,
          coalesce('venue=' || a.venue_outcome, ''), a.created_at
        from lecture_attendance a
        join lecture_sessions s on s.id = a.lecture_session_id
        left join users adder on adder.id = a.added_by_user_id
        ${CLASS_PLACE(sql`a.institution_id`, sql`a.matric_number`)}
        where a.institution_id = ${scope.institutionId}::uuid and a.method = 'manual' ${inScope}
      `);
      branches.push(sql`
        select 'removal:' || a.id, 'student', 'attendee_removed',
          a.removed_by_user_id, remover.display_name, a.full_name, a.matric_number,
          s.course_code || ' · ' || to_char(s.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY'), 'lecture', s.course_code, s.id,
          place.department_code, place.entry_year::int, null, null, null,
          concat_ws(' ', 'venue=' || a.venue_outcome, 'reason=' || a.removed_reason), a.removed_at
        from lecture_attendance a
        join lecture_sessions s on s.id = a.lecture_session_id
        left join users remover on remover.id = a.removed_by_user_id
        ${CLASS_PLACE(sql`a.institution_id`, sql`a.matric_number`)}
        where a.institution_id = ${scope.institutionId}::uuid and a.removed_at is not null ${inScope}
      `);
    }

    // Attendance disputes taken to the department, and the department's decisions on them.
    if (wants('attendance')) {
      const inScope = limited ? sql`and ap.department_id in (${departments})` : sql``;
      const appealFrom = sql`
        from attendance_dispute_appeals ap
        join attendance_sessions s on s.id = ap.attendance_session_id
        join course_offerings o on o.id = ap.course_offering_id
        join courses c on c.id = o.course_id
        join departments dep on dep.id = ap.department_id
        join attendance_disputes dis on dis.id = ap.dispute_id
        left join users rejecter on rejecter.id = dis.resolved_by_user_id
        join users stu on stu.id = ap.student_user_id
        join student_profiles sp on sp.user_id = ap.student_user_id
        ${CLASS_PLACE(sql`ap.institution_id`, sql`sp.student_number`)}`;
      const lecture = sql`c.code || ' · ' || to_char(s.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY')`;
      branches.push(sql`
        select 'appeal:' || ap.id, 'student', 'attendance_appeal_sent',
          ap.student_user_id, stu.display_name, stu.display_name, sp.student_number,
          ${lecture}, 'lecture', c.code, null::uuid,
          place.department_code, place.entry_year::int, null, null, null,
          concat_ws(' ', 'area=' || dep.name, 'lecturer=' || rejecter.display_name, 'reason=' || ap.statement), ap.created_at
        ${appealFrom}
        where ap.institution_id = ${scope.institutionId}::uuid ${inScope}
      `);
      branches.push(sql`
        select 'appeal-decision:' || ap.id, 'student', 'attendance_appeal_' || ap.status::text,
          ap.decided_by_user_id, decider.display_name, stu.display_name, sp.student_number,
          ${lecture}, 'lecture', c.code, null::uuid,
          place.department_code, place.entry_year::int, null, null, null,
          concat_ws(' ', 'area=' || dep.name, 'lecturer=' || rejecter.display_name, 'reason=' || ap.decision_note), ap.decided_at
        ${appealFrom}
        left join users decider on decider.id = ap.decided_by_user_id
        where ap.institution_id = ${scope.institutionId}::uuid and ap.status in ('upheld', 'rejected') ${inScope}
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
          ev.actor_user_id, actor.display_name, coalesce(target.display_name, inv.display_name, inv.email), null,
          null, 'staff', null, null, null, null,
          coalesce(target.email, inv.email), coalesce(inv.role::text, role.role::text),
          coalesce(inv_dep.name, inv_fac.name, role.area),
          coalesce('reason=' || ev.reason, ''), ev.created_at
        from staff_audit_events ev
        left join users actor on actor.id = ev.actor_user_id
        left join users target on target.id = ev.target_user_id
        left join staff_invitations inv on inv.id = ev.invitation_id
        left join departments inv_dep on inv_dep.id = inv.department_id
        left join faculties inv_fac on inv_fac.id = inv.faculty_id
        left join lateral (
          select ra.role, coalesce(rd.name, rf.name) as area
          from user_role_assignments ra
          left join departments rd on rd.id = ra.department_id
          left join faculties rf on rf.id = ra.faculty_id
          where ra.user_id = ev.target_user_id and ra.role <> 'student'
          order by ra.created_at asc limit 1
        ) role on true
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
          ev.actor_user_id, actor.display_name, null, null,
          coalesce(f.name, dep.name, sess.code, b.name, v.name), ev.target_type::text, coalesce(f.code, dep.code, sess.code, b.code, v.code), null,
          null, null, null, null, null,
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
          ev.actor_user_id, actor.display_name, null, null, v.name, 'venue', v.code, null,
          null, null, null, null, null,
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
    if (branches.length === 0) return null;
    return sql`(${sql.join(branches, sql` union all `)}) as u (${COLUMNS})`;
  }

  /** Conditions on the union (`u`) shared by listing and counting. */
  #conditions(filter: Omit<AuditFilter, 'limit'>): SQL[] {
    const conditions: SQL[] = [];
    if (filter.id) conditions.push(sql`u.id = ${filter.id}`);
    if (filter.from) conditions.push(sql`u.created_at >= ${filter.from.toISOString()}::timestamptz`);
    if (filter.to) conditions.push(sql`u.created_at < ${filter.to.toISOString()}::timestamptz`);
    if (filter.actorId) conditions.push(sql`u.actor_id = ${filter.actorId}::uuid`);
    if (filter.actions) conditions.push(filter.actions.length ? sql`u.action in (${list(filter.actions)})` : sql`false`);
    if (filter.notableOnly) {
      conditions.push(sql`(
        u.action in (${list(AUDIT_NOTABLE_ACTIONS)})
        or (u.action in ('department_updated', 'faculty_updated') and replace(u.details, ' ', '') like '%"isActive":[true,false]%')
      )`);
    }
    if (filter.before) {
      conditions.push(sql`(u.created_at, u.id) < (${filter.before.at.toISOString()}::timestamptz, ${filter.before.id})`);
    }
    if (filter.query) {
      const pattern = `%${filter.query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      const compact = `%${filter.query.replace(/\s+/g, '').replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      const digits = filter.query.replace(/\D/g, '');
      conditions.push(sql`(
        u.actor_name ilike ${pattern} or u.subject_name ilike ${pattern} or u.target_label ilike ${pattern}
        or u.staff_email ilike ${pattern} or replace(u.target_code, ' ', '') ilike ${compact}
        ${digits.length >= 4 ? sql`or u.matric_number like ${`%${digits}%`}` : sql``}
      )`);
    }
    return conditions;
  }

  async listAudit(scope: AuditScope, filter: AuditFilter): Promise<AuditRow[]> {
    const source = this.#source(scope, filter.category);
    if (!source) return [];
    const conditions = this.#conditions(filter);
    const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
    const result = await this.database.execute<RawAudit>(sql`
      select * from ${source}
      ${where}
      order by u.created_at desc, u.id desc
      limit ${filter.limit}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      source: row.id.startsWith('venue:') ? 'venue' : row.source,
      action: row.action,
      actorId: row.actor_id,
      actorName: row.actor_name,
      subjectName: row.subject_name,
      matricNumber: row.matric_number,
      targetLabel: row.target_label,
      targetType: row.target_type,
      targetCode: row.target_code,
      sessionId: row.session_id,
      classDepartmentCode: row.class_department_code,
      classEntryYear: row.class_entry_year === null ? null : Number(row.class_entry_year),
      staffEmail: row.staff_email,
      staffRole: row.staff_role,
      staffArea: row.staff_area,
      details: row.details ?? '',
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }));
  }

  async countAudit(scope: AuditScope, filter: Omit<AuditFilter, 'limit' | 'before' | 'id'>, split: Date): Promise<AuditCounts> {
    const source = this.#source(scope, filter.category);
    if (!source) return { rows: [], people: 0 };
    const conditions = this.#conditions(filter);
    const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
    const at = split.toISOString();
    const result = await this.database.execute<{ source: string; action: string; count: number | string; recent: number | string; people: number | string }>(sql`
      with u as (select u.* from ${source} ${where})
      select case when u.id like 'venue:%' then 'venue' else u.source end as source, u.action,
        count(*)::int as count,
        count(*) filter (where u.created_at >= ${at}::timestamptz)::int as recent,
        (select count(distinct p.actor_id) from u p where p.created_at >= ${at}::timestamptz)::int as people
      from u
      group by 1, 2
    `);
    return {
      rows: result.rows.map((row) => ({ source: row.source as AuditRow['source'], action: row.action, count: Number(row.count), recent: Number(row.recent) })),
      people: Number(result.rows[0]?.people ?? 0),
    };
  }

  async resolveReferences(
    institutionId: string,
    ids: { readonly departments: readonly string[]; readonly sessions: readonly string[]; readonly users: readonly string[] },
  ): Promise<AuditReferences> {
    const departments = new Map<string, { code: string; name: string }>();
    const sessions = new Map<string, { courseCode: string; startsAt: Date }>();
    const users = new Map<string, { name: string; matricNumber: string | null }>();
    if (ids.departments.length) {
      const result = await this.database.execute<{ id: string; code: string; name: string }>(sql`
        select id, code, name from departments where institution_id = ${institutionId}::uuid and id in (${uuidList(ids.departments)})
      `);
      for (const row of result.rows) departments.set(row.id, { code: row.code, name: row.name });
    }
    if (ids.sessions.length) {
      const result = await this.database.execute<{ id: string; course_code: string; starts_at: Date | string }>(sql`
        select id, course_code, starts_at from lecture_sessions where institution_id = ${institutionId}::uuid and id in (${uuidList(ids.sessions)})
      `);
      for (const row of result.rows) sessions.set(row.id, { courseCode: row.course_code, startsAt: row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at) });
    }
    if (ids.users.length) {
      const result = await this.database.execute<{ id: string; name: string; matric_number: string | null }>(sql`
        select u.id, u.display_name as name, sp.student_number as matric_number
        from users u left join student_profiles sp on sp.user_id = u.id
        where u.institution_id = ${institutionId}::uuid and u.id in (${uuidList(ids.users)})
      `);
      for (const row of result.rows) users.set(row.id, { name: row.name, matricNumber: row.matric_number });
    }
    return { departments, sessions, users };
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

  /** Class-list user ids in the scope (a subquery), for photos and faces that carry no department. */
  #scopeStudents(scope: AuditScope): SQL {
    return sql`select ce.student_user_id from class_list_entries ce where ce.student_user_id is not null and ce.department_id in (${scopeDepartments(scope)})`;
  }

  async listRetentionSets(scope: AuditScope, policy: RetentionPolicy, now: Date, until: Date): Promise<RetentionSetRow[]> {
    const result = await this.database.execute<{
      department_id: string; department_code: string; department_name: string; entry_year: number; programme_years: number;
      students: number; faces: number; due_faces: number; kept_active: number;
    }>(sql`
      select d.id as department_id, d.code as department_code, d.name as department_name,
        e.entry_year::int as entry_year, d.programme_years::int as programme_years,
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
      where e.institution_id = ${scope.institutionId}::uuid
        and e.department_id in (${scopeDepartments(scope)})
        and ${FINISHED_ON} + make_interval(months => ${policy.graceMonths}::int) <= ${until.toISOString()}::timestamptz
      group by d.id, d.code, d.name, e.entry_year, d.programme_years
      order by e.entry_year asc, d.name asc
      limit 2000
    `);
    return result.rows.map((row) => ({
      departmentId: row.department_id,
      departmentCode: row.department_code,
      departmentName: row.department_name,
      entryYear: Number(row.entry_year),
      programmeYears: Number(row.programme_years),
      students: Number(row.students),
      faces: Number(row.faces),
      dueFaces: Number(row.due_faces),
      keptActive: Number(row.kept_active),
    }));
  }

  async retentionHolding(scope: AuditScope, policy: RetentionPolicy, now: Date): Promise<RetentionHolding> {
    const cutoff = new Date(now.getTime() - policy.checkPhotoDays * 86_400_000).toISOString();
    const limited = scope.type !== 'institution';
    const facesIn = limited ? sql`and f.user_id in (${this.#scopeStudents(scope)})` : sql``;
    const photosIn = limited ? sql`and c.student_user_id in (${this.#scopeStudents(scope)})` : sql``;
    const result = await this.database.execute<{
      faces: number; faces_unlisted: number; check_photos: number; oldest_photo: Date | string | null; due_photos: number;
    }>(sql`
      select
        (select count(*) from student_face_profiles f where f.institution_id = ${scope.institutionId}::uuid ${facesIn})::int as faces,
        ${limited ? sql`0` : sql`(select count(*) from student_face_profiles f
          where f.institution_id = ${scope.institutionId}::uuid
            and not exists (select 1 from class_list_entries ce where ce.student_user_id = f.user_id))`}::int as faces_unlisted,
        photos.count::int as check_photos,
        photos.oldest as oldest_photo,
        (select count(*) from lecture_face_checks c
          where c.institution_id = ${scope.institutionId}::uuid and c.photo is not null ${photosIn}
            and (c.created_at < ${cutoff}::timestamptz or c.student_user_id in (${this.#dueUsers(scope.institutionId, policy, now)})))::int as due_photos
      from (
        select count(*) as count, min(c.created_at) as oldest from lecture_face_checks c
        where c.institution_id = ${scope.institutionId}::uuid and c.photo is not null ${photosIn}
      ) photos
    `);
    const row = result.rows[0];
    const oldest = row?.oldest_photo ?? null;
    return {
      faces: Number(row?.faces ?? 0),
      facesUnlisted: Number(row?.faces_unlisted ?? 0),
      checkPhotos: Number(row?.check_photos ?? 0),
      oldestCheckPhotoAt: oldest === null ? null : oldest instanceof Date ? oldest : new Date(oldest),
      dueCheckPhotos: Number(row?.due_photos ?? 0),
    };
  }

  async listSetStudents(scope: AuditScope, departmentId: string, entryYear: number, limit: number): Promise<RetentionSetStudents | null> {
    const department = await this.database.execute<{ id: string; code: string; name: string; programme_years: number }>(sql`
      select d.id, d.code, d.name, d.programme_years::int as programme_years from departments d
      where d.id = ${departmentId}::uuid and d.institution_id = ${scope.institutionId}::uuid and d.id in (${scopeDepartments(scope)})
    `);
    const found = department.rows[0];
    if (!found) return null;
    const result = await this.database.execute<{
      matric_number: string; surname: string; first_name: string; middle_name: string | null; display_name: string | null;
      user_id: string | null; enrolled_at: Date | string | null; last_at: Date | string | null; photos: number;
    }>(sql`
      select e.matric_number, e.surname, e.first_name, e.middle_name, u.display_name, e.student_user_id as user_id,
        f.enrolled_at, act.last_at, coalesce(ph.count, 0)::int as photos
      from class_list_entries e
      left join users u on u.id = e.student_user_id
      left join student_face_profiles f on f.user_id = e.student_user_id
      left join lateral (
        select max(a.created_at) as last_at from lecture_attendance a
        where e.student_user_id is not null and a.student_user_id = e.student_user_id and a.removed_at is null
      ) act on true
      left join lateral (
        select count(*) as count from lecture_face_checks c
        where e.student_user_id is not null and c.student_user_id = e.student_user_id and c.photo is not null
      ) ph on true
      where e.institution_id = ${scope.institutionId}::uuid and e.department_id = ${departmentId}::uuid and e.entry_year = ${entryYear}
      order by e.surname asc, e.first_name asc, e.matric_number asc
      limit ${limit}
    `);
    const date = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value : new Date(value));
    return {
      department: { id: found.id, code: found.code, name: found.name, programmeYears: Number(found.programme_years) },
      students: result.rows.map((row) => ({
        matricNumber: row.matric_number,
        surname: row.surname,
        firstName: row.first_name,
        middleName: row.middle_name,
        displayName: row.display_name,
        userId: row.user_id,
        faceRegisteredAt: date(row.enrolled_at),
        lastCheckInAt: date(row.last_at),
        checkPhotos: Number(row.photos),
      })),
    };
  }

  async listRetentionRuns(institutionId: string, limit: number): Promise<RetentionRunRecord[]> {
    const result = await this.database.execute<{ created_at: Date | string; actor_name: string | null; details: string }>(sql`
      select ev.created_at, actor.display_name as actor_name, ev.details
      from student_audit_events ev
      left join users actor on actor.id = ev.actor_user_id
      where ev.institution_id = ${institutionId}::uuid and ev.action = 'retention_run' and ev.subject_user_id is null
      order by ev.created_at desc
      limit ${limit}
    `);
    return result.rows.map((row) => ({
      at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      actorName: row.actor_name,
      details: row.details,
    }));
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
