import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    application_name: 'lasuatos-api',
  });

  const db = drizzle({ client: pool, schema });

  return {
    db,
    async checkConnection(): Promise<void> {
      await pool.query('select 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
