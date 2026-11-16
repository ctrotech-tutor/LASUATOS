import { sql, type SQL } from 'drizzle-orm';
import type { DatabaseClient } from '@lasuatos/database';
import type { ContactMessageStatus, ContactPrivacyRequest, ContactRole, ContactTopic } from '@lasuatos/contracts';
import type { ContactListFilter, ContactMessageRow, ContactRecipient, ContactRepository, ContactSummaryRow, NewContactMessage } from './repository.js';

interface RawMessage extends Record<string, unknown> {
  id: string;
  reference: string;
  topic: string;
  status: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  matric_number: string | null;
  privacy_request: string | null;
  page: string | null;
  device: string | null;
  students: number | null;
  message: string;
  sender_user_id: string | null;
  created_at: Date | string;
  handled_at: Date | string | null;
  handled_by_name: string | null;
  handled_note: string | null;
}

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function toRow(raw: RawMessage): ContactMessageRow {
  return {
    id: raw.id,
    reference: raw.reference,
    topic: raw.topic as ContactTopic,
    status: raw.status as ContactMessageStatus,
    name: raw.name,
    email: raw.email,
    role: raw.role as ContactRole | null,
    department: raw.department,
    matricNumber: raw.matric_number,
    privacyRequest: raw.privacy_request as ContactPrivacyRequest | null,
    page: raw.page,
    device: raw.device,
    students: raw.students === null ? null : Number(raw.students),
    message: raw.message,
    senderUserId: raw.sender_user_id,
    createdAt: asDate(raw.created_at),
    handledAt: raw.handled_at === null ? null : asDate(raw.handled_at),
    handledByName: raw.handled_by_name,
    note: raw.handled_note,
  };
}

const SELECT = sql`
  select m.id, m.reference, m.topic, m.status, m.name, m.email, m.role, m.department, m.matric_number,
         m.privacy_request, m.page, m.device, m.students, m.message, m.sender_user_id, m.created_at,
         m.handled_at, m.handled_note, h.display_name as handled_by_name
  from contact_messages m
  left join users h on h.id = m.handled_by_user_id`;

export class PostgresContactRepository implements ContactRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(message: NewContactMessage): Promise<{ readonly id: string }> {
    const result = await this.database.execute<{ id: string }>(sql`
      insert into contact_messages (reference, topic, name, email, role, department, matric_number, privacy_request,
                                    page, device, students, message, sender_user_id, created_at)
      values (${message.reference}, ${message.topic}, ${message.name}, ${message.email}, ${message.role}, ${message.department},
              ${message.matricNumber}, ${message.privacyRequest}, ${message.page}, ${message.device}, ${message.students},
              ${message.message}, ${message.senderUserId}::uuid, ${message.createdAt})
      returning id`);
    const row = result.rows[0];
    if (!row) throw new Error('The message was not saved.');
    return { id: row.id };
  }

  async list(filter: ContactListFilter): Promise<ContactMessageRow[]> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(sql`m.status = ${filter.status}`);
    if (filter.topic) conditions.push(sql`m.topic = ${filter.topic}`);
    const query = filter.query?.trim();
    if (query) {
      const like = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      conditions.push(sql`(m.reference = ${query.toUpperCase()} or m.name ilike ${like} or m.email ilike ${like} or m.message ilike ${like})`);
    }
    if (filter.before) conditions.push(sql`(m.created_at, m.id) < (${filter.before.at}, ${filter.before.id}::uuid)`);
    const where = conditions.length ? sql` where ${sql.join(conditions, sql` and `)}` : sql``;
    const result = await this.database.execute<RawMessage>(sql`${SELECT}${where} order by m.created_at desc, m.id desc limit ${filter.limit}`);
    return result.rows.map(toRow);
  }

  async counts(): Promise<{ readonly new: number; readonly handled: number }> {
    const result = await this.database.execute<{ new: number | string; handled: number | string }>(sql`
      select count(*) filter (where status = 'new') as new, count(*) filter (where status = 'handled') as handled
      from contact_messages`);
    const row = result.rows[0];
    return { new: Number(row?.new ?? 0), handled: Number(row?.handled ?? 0) };
  }

  async summary(input: { readonly handledSince: Date; readonly medianSince: Date }): Promise<ContactSummaryRow> {
    const [fresh, handled] = await Promise.all([
      this.database.execute<{ id: string; reference: string; name: string; topic: string; privacy_request: string | null; created_at: Date | string }>(sql`
        select id, reference, name, topic, privacy_request, created_at from contact_messages
        where status = 'new' order by created_at asc, id asc limit 2000`),
      this.database.execute<{ recent: number | string; median_hours: number | string | null }>(sql`
        select count(*) filter (where handled_at >= ${input.handledSince}) as recent,
               percentile_cont(0.5) within group (order by extract(epoch from (handled_at - created_at)) / 3600)
                 filter (where handled_at >= ${input.medianSince}) as median_hours
        from contact_messages where status = 'handled'`),
    ]);
    const median = handled.rows[0]?.median_hours;
    return {
      newMessages: fresh.rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        name: row.name,
        topic: row.topic as ContactTopic,
        privacyRequest: row.privacy_request as ContactPrivacyRequest | null,
        createdAt: asDate(row.created_at),
      })),
      handledSince: Number(handled.rows[0]?.recent ?? 0),
      medianHandleHours: median === null || median === undefined ? null : Math.max(0, Number(median)),
    };
  }

  async findByReference(reference: string): Promise<ContactMessageRow | null> {
    const result = await this.database.execute<RawMessage>(sql`${SELECT} where m.reference = ${reference}`);
    const row = result.rows[0];
    return row ? toRow(row) : null;
  }

  async listByEmail(input: { readonly email: string; readonly excludeId: string; readonly limit: number }): Promise<ContactMessageRow[]> {
    const result = await this.database.execute<RawMessage>(sql`${SELECT}
      where lower(m.email) = lower(${input.email}) and m.id <> ${input.excludeId}::uuid
      order by m.created_at desc, m.id desc limit ${input.limit}`);
    return result.rows.map(toRow);
  }

  async setStatus(input: { readonly id: string; readonly status: ContactMessageStatus; readonly note: string | null; readonly actorUserId: string; readonly now: Date }): Promise<ContactMessageRow | null> {
    const handled = input.status === 'handled';
    const updated = await this.database.execute<{ id: string }>(handled
      ? sql`
        update contact_messages
        set handled_at = case when status = 'handled' then handled_at else ${input.now} end,
            handled_by_user_id = case when status = 'handled' then handled_by_user_id else ${input.actorUserId}::uuid end,
            handled_note = ${input.note},
            status = 'handled'
        where id = ${input.id}::uuid
        returning id`
      : sql`
        update contact_messages
        set status = 'new', handled_at = null, handled_by_user_id = null, handled_note = null
        where id = ${input.id}::uuid
        returning id`);
    if (!updated.rows[0]) return null;
    const result = await this.database.execute<RawMessage>(sql`${SELECT} where m.id = ${input.id}::uuid`);
    const row = result.rows[0];
    return row ? toRow(row) : null;
  }

  async teamRecipients(): Promise<ContactRecipient[]> {
    const result = await this.database.execute<{ email: string; display_name: string }>(sql`
      select distinct u.email, u.display_name
      from user_role_assignments r
      join users u on u.id = r.user_id
      where r.role = 'institution_administrator' and u.status = 'active'
      order by u.email
      limit 10`);
    return result.rows.map((row) => ({ email: row.email, displayName: row.display_name }));
  }

  async prune(input: { readonly handledBefore: Date; readonly anyBefore: Date }): Promise<number> {
    const result = await this.database.execute<{ id: string }>(sql`
      delete from contact_messages
      where (status = 'handled' and handled_at < ${input.handledBefore}) or created_at < ${input.anyBefore}
      returning id`);
    return result.rows.length;
  }
}
