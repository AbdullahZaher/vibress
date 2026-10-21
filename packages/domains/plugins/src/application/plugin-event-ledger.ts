import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, pluginEventReceipts } from "@vibress/database";
import {
  PluginWorkerEventJobSchema, type PluginWorkerEventJob,
} from "@vibress/api-contracts";

/** The identity is stable and scoped: it cannot be selected by a plugin. */
export function pluginEventJobId(job: PluginWorkerEventJob): string {
  return "plugin-" + createHash("sha256")
    .update(JSON.stringify([job.publicationId, job.pluginId, job.eventId]))
    .digest("hex");
}
export function pluginEventEnvelopeHash(job: PluginWorkerEventJob): string {
  const { traceparent: _trace, ...payload } = PluginWorkerEventJobSchema.parse(job);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class PluginEventConflictError extends Error {
  constructor() { super("Event ID is already bound to a different envelope"); }
}
export class PluginEventLedgerError extends Error {
  constructor() { super("Plugin event receipt is not available"); }
}

export type PluginEventReceiptStatus =
  | "pending" | "dispatching" | "queued" | "executed" | "retired";

export interface ClaimedPluginEvent {
  readonly id: string;
  readonly envelope: PluginWorkerEventJob;
  readonly envelopeHash: string;
}

/** Durable admission and crash-safe dispatch claim, independent of Redis.
 * Receipt records are never deleted automatically: dedup spans upgrades. */
export class DrizzlePluginEventLedger {
  /** Fail worker startup before claiming readiness on unmigrated installs. */
  async assertReady(): Promise<void> {
    await getDb().select({ id: pluginEventReceipts.id })
      .from(pluginEventReceipts).limit(0);
  }

  async admit(input: PluginWorkerEventJob): Promise<string> {
    const job = PluginWorkerEventJobSchema.parse(input);
    const id = pluginEventJobId(job);
    const hash = pluginEventEnvelopeHash(job);
    await getDb().insert(pluginEventReceipts).values({
      id,
      eventId: job.eventId,
      pluginId: job.pluginId,
      publicationId: job.publicationId,
      envelopeHash: hash,
      envelope: job,
      status: "pending",
    }).onConflictDoNothing();
    const [saved] = await getDb()
      .select({ envelopeHash: pluginEventReceipts.envelopeHash })
      .from(pluginEventReceipts)
      .where(eq(pluginEventReceipts.id, id)).limit(1);
    if (!saved) throw new PluginEventLedgerError();
    if (saved.envelopeHash !== hash) throw new PluginEventConflictError();
    return id;
  }

  async isAdmitted(job: PluginWorkerEventJob): Promise<boolean> {
    const id = pluginEventJobId(job);
    const [saved] = await getDb().select({
      hash: pluginEventReceipts.envelopeHash,
      status: pluginEventReceipts.status,
    }).from(pluginEventReceipts)
      .where(eq(pluginEventReceipts.id, id)).limit(1);
    if (!saved) return false;
    if (saved.hash !== pluginEventEnvelopeHash(job)) return false;
    return saved.status === "queued" || saved.status === "dispatching" ||
      saved.status === "pending";
  }

  async claimReady(limit = 25): Promise<ClaimedPluginEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new PluginEventLedgerError();
    }
    // Pending rows are persisted before 202. A crashed dispatcher can leave
    // 'dispatching' rows, reclaimed after two minutes with SKIP LOCKED.
    const result = await getDb().execute(sql`
      UPDATE ${pluginEventReceipts}
      SET status = 'dispatching', updated_at = now()
      WHERE id IN (
        SELECT id FROM ${pluginEventReceipts}
        WHERE (status = 'pending' AND updated_at <= now() - interval '5 seconds')
           OR (status = 'dispatching' AND updated_at <= now() - interval '2 minutes')
        ORDER BY created_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) RETURNING id, envelope, envelope_hash
    `);
    const claims: ClaimedPluginEvent[] = [];
    for (const raw of result.rows) {
      const parsed = PluginWorkerEventJobSchema.safeParse(raw.envelope);
      if (!parsed.success || pluginEventJobId(parsed.data) !== raw.id ||
          pluginEventEnvelopeHash(parsed.data) !== raw.envelope_hash) {
        // A corrupt ledger row must never dispatch as a trusted plugin event.
        await this.finalize(String(raw.id), "retired");
        continue;
      }
      claims.push({ id: String(raw.id), envelope: parsed.data,
        envelopeHash: String(raw.envelope_hash) });
    }
    return claims;
  }

  async markQueued(id: string): Promise<void> {
    await getDb().update(pluginEventReceipts)
      .set({ status: "queued", updatedAt: new Date() })
      .where(and(eq(pluginEventReceipts.id, id),
        eq(pluginEventReceipts.status, "dispatching")));
  }

  async returnPending(id: string): Promise<void> {
    await getDb().update(pluginEventReceipts)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(pluginEventReceipts.id, id),
        eq(pluginEventReceipts.status, "dispatching")));
  }

  async finalize(id: string, outcome: "executed" | "retired"): Promise<void> {
    await getDb().update(pluginEventReceipts).set({
      status: outcome, finalizedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(pluginEventReceipts.id, id),
      inArray(pluginEventReceipts.status, ["pending", "queued", "dispatching"])));
  }
}

export const pluginEventLedger = new DrizzlePluginEventLedger();
