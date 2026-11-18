// What a database holds, measured the same way on the live database (inside the backup's
// snapshot) and on the restored copy, so compareInventories() can prove they match.

/** Schemas PostgreSQL owns; everything else (public, drizzle, …) is ours. */
const SYSTEM_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'`;

/**
 * Run inside one REPEATABLE READ transaction, so every statement sees the backup's snapshot.
 * Tables come from pg_class, not information_schema: a table the backup user may not read is
 * then an error ("permission denied"), never a table silently left out. Row counts are exact
 * (count(*)).
 */
export const CATALOG_SQL = `
with user_tables as (
  select c.oid, n.nspname, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and ${SYSTEM_SCHEMAS}
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
)
select json_build_object(
  'tables', coalesce((select json_agg(json_build_object('schema', nspname, 'name', relname) order by nspname, relname) from user_tables), '[]'::json),
  'sequences', coalesce((
    select json_agg(json_build_object('schema', n.nspname, 'name', c.relname) order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and ${SYSTEM_SCHEMAS}
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  ), '[]'::json),
  'objects', json_build_object(
    'schemas', (select count(*) from pg_namespace n where ${SYSTEM_SCHEMAS} and n.nspname <> 'public'),
    'indexes', (select count(*) from pg_index i join user_tables t on t.oid = i.indrelid),
    'constraints', (select count(*) from pg_constraint k join user_tables t on t.oid = k.conrelid),
    'triggers', (select count(*) from pg_trigger g join user_tables t on t.oid = g.tgrelid where not g.tgisinternal),
    'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${SYSTEM_SCHEMAS}
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    'views', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('v', 'm') and ${SYSTEM_SCHEMAS}),
    'types', (select count(*) from pg_type y join pg_namespace n on n.oid = y.typnamespace where y.typtype in ('e', 'd') and ${SYSTEM_SCHEMAS}
      and not exists (select 1 from pg_depend d where d.objid = y.oid and d.deptype = 'e')),
    'enum labels', (select count(*) from pg_enum e join pg_type y on y.oid = e.enumtypid join pg_namespace n on n.oid = y.typnamespace where ${SYSTEM_SCHEMAS})
  ),
  'extensions', coalesce((select json_agg(extname order by extname) from pg_extension where extname <> 'plpgsql'), '[]'::json)
) as catalog`;

const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const literal = (text) => `'${String(text).replaceAll("'", "''")}'`;
const qualified = (item) => `${quote(item.schema)}.${quote(item.name)}`;
/** How a name reads in reports: plain when it is a plain identifier, quoted otherwise. */
const part = (identifier) => (/^[a-z_][a-z0-9_]*$/.test(identifier) ? identifier : quote(identifier));
const label = (item) => `${part(item.schema)}.${part(item.name)}`;

/** Builds one statement that counts every table (union all), so it is one round trip. */
export function countSql(tables) {
  if (tables.length === 0) return null;
  return tables.map((table) => `select ${literal(label(table))} as name, count(*)::text as rows from ${qualified(table)}`).join('\nunion all\n');
}

/** Builds one statement that reads where every sequence stands (null until first used). */
export function sequenceSql(sequences) {
  if (sequences.length === 0) return null;
  return sequences.map((sequence) => `select ${literal(label(sequence))} as name, case when is_called then last_value::text end as value from ${qualified(sequence)}`).join('\nunion all\n');
}

/** Reads the inventory through a connected node-postgres client (inside the snapshot's transaction). */
export async function readInventory(client) {
  const catalog = (await client.query(CATALOG_SQL)).rows[0].catalog;
  const counts = countSql(catalog.tables);
  const values = sequenceSql(catalog.sequences);
  const tables = counts ? (await client.query(counts)).rows.map((row) => ({ name: row.name, rows: Number(row.rows) })) : [];
  const sequences = values ? (await client.query(values)).rows.map((row) => ({ name: row.name, value: row.value ?? null })) : [];
  return {
    tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    sequences: sequences.sort((a, b) => a.name.localeCompare(b.name)),
    objects: Object.fromEntries(Object.entries(catalog.objects).map(([kind, count]) => [kind, Number(count)])),
    extensions: catalog.extensions,
  };
}

/** Whether this login can change any of our tables. The backup user should not. */
export async function canWrite(client) {
  const result = await client.query(`
    select coalesce(bool_or(has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')), false)
        or (select rolsuper from pg_roles where rolname = current_user) as writes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and ${SYSTEM_SCHEMAS}`);
  return Boolean(result.rows[0].writes);
}

/** The newest migration the database has applied (drizzle's journal), or null if it has none. */
export async function appliedMigration(client) {
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') is not null as present`);
  if (!exists.rows[0].present) return null;
  const result = await client.query('select max(created_at)::text as at from drizzle.__drizzle_migrations');
  return result.rows[0].at === null ? null : Number(result.rows[0].at);
}
