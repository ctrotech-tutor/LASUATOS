import { and, asc, count, eq, sql } from 'drizzle-orm';
import { passkeyChallenges, passkeys, type DatabaseClient } from '@lasuatos/database';
import type { ChallengePurpose, PasskeyRecord, PasskeyRepository } from './passkeys.js';

type PasskeyRow = typeof passkeys.$inferSelect;

function toRecord(row: PasskeyRow): PasskeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    credentialId: row.credentialId,
    publicKey: new Uint8Array(row.publicKey),
    signCount: Number(row.signCount),
    transports: row.transports,
    backedUp: row.backedUp,
    aaguid: row.aaguid,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
};

export class PostgresPasskeyRepository implements PasskeyRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(userId: string): Promise<PasskeyRecord[]> {
    const rows = await this.database.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt), asc(passkeys.id));
    return rows.map(toRecord);
  }

  async saveChallenge(input: { readonly challenge: string; readonly purpose: ChallengePurpose; readonly userId: string | null; readonly expiresAt: Date }): Promise<string> {
    const [row] = await this.database.insert(passkeyChallenges).values({
      challenge: input.challenge,
      purpose: input.purpose,
      userId: input.userId,
      expiresAt: input.expiresAt,
    }).returning({ id: passkeyChallenges.id });
    return row!.id;
  }

  async takeChallenge(id: string, purpose: ChallengePurpose, now: Date): Promise<{ readonly challenge: string; readonly userId: string | null } | null> {
    // Deleted whether or not it has expired: an expired one is no use either.
    const [row] = await this.database.delete(passkeyChallenges)
      .where(and(eq(passkeyChallenges.id, id), eq(passkeyChallenges.purpose, purpose)))
      .returning({ challenge: passkeyChallenges.challenge, userId: passkeyChallenges.userId, expiresAt: passkeyChallenges.expiresAt });
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return { challenge: row.challenge, userId: row.userId };
  }

  async add(input: Omit<PasskeyRecord, 'id' | 'createdAt' | 'lastUsedAt'> & { readonly now: Date; readonly maxPerAccount: number }): Promise<PasskeyRecord | 'limit' | 'duplicate'> {
    try {
      return await this.database.transaction(async (transaction) => {
        // One add at a time per account, so two tabs cannot both slip under the limit.
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`passkeys:${input.userId}`}, 0))`);
        const [existing] = await transaction.select({ total: count() }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((existing?.total ?? 0) >= input.maxPerAccount) return 'limit' as const;
        const [row] = await transaction.insert(passkeys).values({
          userId: input.userId,
          credentialId: input.credentialId,
          publicKey: Buffer.from(input.publicKey),
          signCount: input.signCount,
          transports: [...input.transports],
          backedUp: input.backedUp,
          aaguid: input.aaguid,
          name: input.name,
          createdAt: input.now,
        }).returning();
        return toRecord(row!);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  async findByCredentialId(credentialId: string): Promise<PasskeyRecord | null> {
    const [row] = await this.database.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
    return row ? toRecord(row) : null;
  }

  async recordUse(input: { readonly id: string; readonly previousSignCount: number; readonly signCount: number; readonly backedUp: boolean; readonly now: Date }): Promise<boolean> {
    const updated = await this.database.update(passkeys)
      .set({ signCount: input.signCount, backedUp: input.backedUp, lastUsedAt: input.now })
      .where(and(eq(passkeys.id, input.id), eq(passkeys.signCount, input.previousSignCount)))
      .returning({ id: passkeys.id });
    return updated.length === 1;
  }

  async rename(input: { readonly userId: string; readonly id: string; readonly name: string }): Promise<PasskeyRecord | null> {
    const [row] = await this.database.update(passkeys)
      .set({ name: input.name })
      .where(and(eq(passkeys.id, input.id), eq(passkeys.userId, input.userId)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async remove(input: { readonly userId: string; readonly id: string }): Promise<PasskeyRecord | null> {
    const [row] = await this.database.delete(passkeys)
      .where(and(eq(passkeys.id, input.id), eq(passkeys.userId, input.userId)))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Whether the account has any passkey (a password sign-in then emails a notice). */
  async hasAny(userId: string): Promise<boolean> {
    const [row] = await this.database.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId)).limit(1);
    return Boolean(row);
  }
}
