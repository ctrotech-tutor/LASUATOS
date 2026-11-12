import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { LATEST_MIGRATION, type SchemaStatus } from './migrations.js';
import * as schema from './schema/index.js';

export interface DatabaseOptions {
  /** Pool size per process. Keep it small in serverless functions (each instance has its own pool). */
  readonly maxConnections?: number;
  readonly idleTimeoutMillis?: number;
  /** Serverless databases such as Neon wake from idle on the first connection, which can take a few seconds. */
  readonly connectionTimeoutMillis?: number;
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 3_000,
    application_name: 'lasuatos-api',
  });

  const db = drizzle({ client: pool, schema });

  return {
    db,
    async checkConnection(): Promise<void> {
      await pool.query('select 1');
    },
    /** Whether every migration shipped with this code has been applied (drizzle-kit's ledger). */
    async schemaStatus(): Promise<SchemaStatus> {
      try {
        const result = await pool.query<{ latest: string | null }>('select max(created_at)::text as latest from drizzle.__drizzle_migrations');
        const latest = Number(result.rows[0]?.latest ?? Number.NaN);
        if (!Number.isFinite(latest)) return 'behind';
        return latest >= LATEST_MIGRATION.createdAt ? 'current' : 'behind';
      } catch {
        // The ledger lives in the "drizzle" schema; without it nothing was migrated with drizzle-kit.
        return 'unknown';
      }
    },
    /** Runs plain SQL inside one transaction (used by operator CLIs such as institution setup). */
    async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
