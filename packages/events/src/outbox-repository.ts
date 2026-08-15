import { sql, inArray } from "drizzle-orm";
import { getDb } from "@vibress/database";
import {
  outboxEvents,
  OutboxEventRow,
  NewOutboxEventRow,
} from "@vibress/database";

export type { OutboxEventRow, NewOutboxEventRow };

export const OUTBOX_CLAIM_BATCH_SIZE = 100;

export interface OutboxRepository {
  insert(row: NewOutboxEventRow): Promise<void>;
  /**
   * Atomically claims up to limit dispatchable rows and marks them
   * 'delivering'. Only one dispatcher wins each row (FOR UPDATE SKIP LOCKED).
   * Rows whose availableAfter is in the future are left for later.
   */
  claimReady(opts: { limit?: number; now?: Date }): Promise<OutboxEventRow[]>;
  markPublished(ids: string[]): Promise<void>;
  /**
   * Records a failed delivery attempt. Sets attempts = attempts + 1; when
   * attempts exceed maxAttempts the row transitions to 'failed', otherwise it
   * returns to 'pending' with a backoff window via availableAfter.
   */
  markFailed(
    id: string,
    error: string,
    opts: { maxAttempts: number },
  ): Promise<void>;
  /** Reclaims claims that have been 'delivering' past the stale threshold. */
  reclaimStaleClaims(opts: {
    staleAfterMs: number;
    now?: Date;
  }): Promise<number>;
  /** Deletes rows whose fate was decided long ago (retention). */
  purge(opts: { publishedBefore: Date; failedBefore: Date }): Promise<void>;
}

export class DrizzleOutboxRepository implements OutboxRepository {
  async insert(row: NewOutboxEventRow): Promise<void> {
    const db = getDb();
    await db.insert(outboxEvents).values(row);
  }

  async claimReady(
    opts: { limit?: number; now?: Date } = {},
  ): Promise<OutboxEventRow[]> {
    const db = getDb();
    const limit = opts.limit ?? OUTBOX_CLAIM_BATCH_SIZE;
    const now = opts.now ?? new Date();
    const result = await db.execute(sql`
      UPDATE ${outboxEvents}
      SET status = 'delivering', updated_at = now()
      WHERE id IN (
        SELECT id FROM ${outboxEvents}
        WHERE status = 'pending'
          AND (available_after IS NULL OR available_after <= ${now})
        ORDER BY created_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const rows = mapRows(result.rows);
    // PostgreSQL does not guarantee RETURNING row order, even when the
    // selection subquery is ordered — rows come back in scan/update order.
    // Restore the deterministic claim order (created_at, id) so dispatcher
    // delivery order is stable regardless of the execution plan. Raw
    // db.execute returns created_at as an ISO string, which compares
    // correctly as text.
    rows.sort((a, b) => {
      const ta = String(a.createdAt);
      const tb = String(b.createdAt);
      return ta < tb
        ? -1
        : ta > tb
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
    });
    return rows;
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = getDb();
    await db
      .update(outboxEvents)
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(outboxEvents.id, ids));
  }

  async markFailed(
    id: string,
    error: string,
    opts: { maxAttempts: number },
  ): Promise<void> {
    const db = getDb();
    const maxAttempts = opts.maxAttempts;
    await db.execute(sql`
      UPDATE ${outboxEvents}
      SET
        attempts = attempts + 1,
        last_error = ${error.slice(0, 500)},
        status = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END,
        available_after = CASE WHEN attempts + 1 >= ${maxAttempts} THEN available_after ELSE now() + make_interval(secs => (1 << (attempts + 1))) END,
        updated_at = now()
      WHERE id = ${id}
    `);
  }

  async reclaimStaleClaims(
    opts: { staleAfterMs: number; now?: Date } = { staleAfterMs: 60_000 },
  ): Promise<number> {
    const db = getDb();
    const now = opts.now ?? new Date();
    const result = await db.execute(sql`
      UPDATE ${outboxEvents}
      SET status = 'pending', updated_at = now()
      WHERE status = 'delivering'
        AND updated_at <= ${new Date(now.getTime() - opts.staleAfterMs)}
      RETURNING id
    `);
    return (result.rows ?? []).length;
  }

  async purge(opts: {
    publishedBefore: Date;
    failedBefore: Date;
  }): Promise<void> {
    const db = getDb();
    await db
      .delete(outboxEvents)
      .where(
        sql`${outboxEvents.status} = 'published' AND ${outboxEvents.publishedAt} < ${opts.publishedBefore}`,
      );
    await db
      .delete(outboxEvents)
      .where(
        sql`${outboxEvents.status} = 'failed' AND ${outboxEvents.updatedAt} < ${opts.failedBefore}`,
      );
  }
}

/** Maps raw pg rows (snake_case columns) to typed outbox rows. */
function mapRows(rows: unknown): OutboxEventRow[] {
  const raw = (Array.isArray(rows) ? rows : []) as Array<
    Record<string, unknown>
  >;
  return raw.map((r) => ({
    id: r.id as string,
    eventType: r.event_type as string,
    payload: r.payload as Record<string, unknown>,
    status: r.status as OutboxEventRow["status"],
    attempts: r.attempts as number,
    lastError: (r.last_error as string | null) ?? null,
    availableAfter: (r.available_after as Date | null) ?? null,
    publishedAt: (r.published_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  }));
}

export const defaultOutboxRepository: OutboxRepository =
  new DrizzleOutboxRepository();
