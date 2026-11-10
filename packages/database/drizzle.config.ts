import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (process.argv.includes('migrate') && !databaseUrl) {
  throw new Error('DATABASE_URL is required before applying database migrations.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: databaseUrl || 'postgresql://localhost/lasuatos',
  },
  strict: true,
  verbose: true,
});
