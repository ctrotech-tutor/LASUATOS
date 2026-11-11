import { createDatabase } from './client.js';

export { createDatabase };
export type DatabaseClient = ReturnType<typeof createDatabase>['db'];
export * from './schema/index.js';
