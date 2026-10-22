import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, pluginEventReceipts, auditEvents } from "@vibress/database";
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

function parseReceiptStatus(raw: string): PluginEventReceiptStatus {
  switch (raw) {
    case "pending":
    case "dispatching":
    case "queued":
    case "executed":
    case "retired":
      return raw;
    default:
      throw new PluginEventLedgerError();
  }
}

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

  /** Resolve only an exact publication + plugin + event ID. No caller can
   * select a foreign tenant by knowing a globally valid event identifier. */
  async getReceipt(
    publicationId: string, pluginId: string, eventId: string,
  ): Promise<{ id: string; status: PluginEventReceiptStatus; job: PluginWorkerEventJob } | null> {
    const [saved] = await getDb().select({
      id: pluginEventReceipts.id,
      status: pluginEventReceipts.status,
      hash: pluginEventReceipts.envelopeHash,
      envelope: pluginEventReceipts.envelope,
    }).from(pluginEventReceipts).where(and(
      eq(pluginEventReceipts.publicationId, publicationId),
      eq(pluginEventReceipts.pluginId, pluginId),
      eq(pluginEventReceipts.eventId, eventId),
    )).limit(1);
    if (!saved) return null;
    const parsed = PluginWorkerEventJobSchema.safeParse(saved.envelope);
    if (!parsed.success || parsed.data.publicationId !== publicationId ||
        parsed.data.pluginId !== pluginId || parsed.data.eventId !== eventId ||
        pluginEventJobId(parsed.data) !== saved.id ||
        pluginEventEnvelopeHash(parsed.data) !== saved.hash) {
      throw new PluginEventLedgerError();
    }
    const status = parseReceiptStatus(saved.status);
    return { id: saved.id, status, job: parsed.data };
  }

  /** Audit the operator's replay intention *before* touching Redis. The
   * transaction locks this scoped receipt and refuses terminal deliveries.
   * A Redis outage leaves an audit trail but cannot authorize a new event. */
  async recordReplayRequest(
    publicationId: string, pluginId: string, eventId: string,
    envelopeHash: string,
    audit: { readonly actorUserId: string; readonly requestId: string },
  ): Promise<boolean> {
    if (!audit.actorUserId || !audit.requestId) throw new PluginEventLedgerError();
    return getDb().transaction(async (tx) => {
      const [receipt] = await tx.select({
        id: pluginEventReceipts.id,
        status: pluginEventReceipts.status,
        hash: pluginEventReceipts.envelopeHash,
      }).from(pluginEventReceipts).where(and(
        eq(pluginEventReceipts.publicationId, publicationId),
        eq(pluginEventReceipts.pluginId, pluginId),
        eq(pluginEventReceipts.eventId, eventId),
      )).for("update").limit(1);
      if (!receipt || receipt.status !== "queued" || receipt.hash !== envelopeHash) {
        return false;
      }
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId, actorUserId: audit.actorUserId,
        requestId: audit.requestId, action: "plugin.event_replay_requested",
        targetType: "plugin_event", targetId: receipt.id,
        metadata: { pluginId, eventId },
      });
      return true;
    });
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
