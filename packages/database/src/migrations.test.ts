import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_MIGRATION } from './migrations.js';

describe('LATEST_MIGRATION', () => {
  it('matches the newest entry in the migration journal', () => {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/migrations/meta/_journal.json', import.meta.url), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const newest = journal.entries[journal.entries.length - 1];
    expect(LATEST_MIGRATION).toEqual({ tag: newest?.tag, createdAt: newest?.when });
  });
});
