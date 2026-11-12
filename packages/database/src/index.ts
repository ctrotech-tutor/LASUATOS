import { createDatabase } from './client.js';

export { createDatabase };
export { LATEST_MIGRATION, type SchemaStatus } from './migrations.js';
export type DatabaseClient = ReturnType<typeof createDatabase>['db'];
export * from './schema/index.js';
