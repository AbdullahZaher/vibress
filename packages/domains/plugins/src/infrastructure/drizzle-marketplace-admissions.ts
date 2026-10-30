import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  getDb, plugins, pluginMarketplaceAdmissions, pluginMarketplacePublisherRevocations,
  pluginPublicationStates, auditEvents,
} from "@vibress/database";
import type { AuthoritativePluginAdmission } from "../runtime/tier2-process-supervisor.js";

/**
 * Operator-owned, versioned PostgreSQL admission authority for Tier 2.
 *
 * This class has NO plugin SDK, HTTP or caller-granted authorization API.
 * Operator writes MUST follow authenticated operator authorization, trusted
 * publisher signature verification, immutable artifact staging and approval.
 * A plugin ID, actor ID, or a purported release digest is never sufficient
 * authority to call an operator write.
 */
export class MarketplaceAdmissionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MarketplaceAdmissionError";
  }
}

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const MarketplaceAdmissionInput = z.object({
  pluginId: z.string().min(1).max(256),
  releaseDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
  trustTier: z.literal("untrusted_marketplace"),
  publisherId: z.string().min(1).max(256),
  releaseDirectory: z.string().min(2).max(4096).startsWith("/"),
  allowedEntrypoints: z.array(z.string().startsWith("/").max(4096)).min(1).max(32),
  releaseArtifactManifest: z.record(z.string().min(1), Sha256).refine(
    (manifest) => Object.keys(manifest).length > 0 && Object.keys(manifest).length <= 4096,
  ),
  approvedPublicationIds: z.array(z.string().min(1).max(256)).min(1).max(1000),
  approvedCapabilities: z.array(z.string().min(1).max(256)).max(128),
  entrypointSha256: Sha256.optional(),
}).strict();

export type OperatorMarketplaceReleaseGrant = z.infer<typeof MarketplaceAdmissionInput>;

export interface MarketplaceOperatorAudit {
  readonly actorUserId: string;
  readonly requestId: string;
}

/** Validates raw persisted JSONB before trusting it for a kernel sandbox. */
export function parseDurableMarketplaceAdmission(raw: unknown): OperatorMarketplaceReleaseGrant {
  const checked = MarketplaceAdmissionInput.safeParse(raw);
  if (!checked.success) throw new MarketplaceAdmissionError("MARKETPLACE_ADMISSION_INVALID");
  if (new Set(checked.data.approvedPublicationIds).size !== checked.data.approvedPublicationIds.length ||
      new Set(checked.data.approvedCapabilities).size !== checked.data.approvedCapabilities.length ||
      new Set(checked.data.allowedEntrypoints).size !== checked.data.allowedEntrypoints.length) {
    throw new MarketplaceAdmissionError("MARKETPLACE_ADMISSION_DUPLICATE_GRANT");
  }
  return checked.data;
}

function ensureOperatorAudit(audit: MarketplaceOperatorAudit): void {
  if (!audit.actorUserId.trim() || !audit.requestId.trim()) {
    throw new MarketplaceAdmissionError("MARKETPLACE_OPERATOR_AUDIT_REQUIRED");
  }
}

const parseRow = (row: typeof pluginMarketplaceAdmissions.$inferSelect): AuthoritativePluginAdmission => {
  const admission = parseDurableMarketplaceAdmission(row.admission);
  if (admission.pluginId !== row.pluginId || admission.publisherId !== row.publisherId ||
      !Number.isSafeInteger(row.policyRevision) || row.policyRevision < 1) {
    throw new MarketplaceAdmissionError("MARKETPLACE_ADMISSION_INTEGRITY_MISMATCH");
  }
  return {
    ...admission,
    policyRevision: row.policyRevision,
    isRevoked: row.revoked,
  };
};

/**
 * Reads the REAL DB on each invocation. Missing/disabled publication, missing
 * row, missing active plugin, corrupt JSON, or DB failure cannot grant access.
 * This can be used as the Supervisor's `loadMarketplaceAdmission` callback.
 */
export class DrizzleMarketplaceAdmissionRepository {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  async loadMarketplaceAdmission(
    pluginId: string,
    publicationId: string,
  ): Promise<AuthoritativePluginAdmission | null> {
    // One PostgreSQL statement provides one consistent READ COMMITTED
    // snapshot of the admission, plugin lifecycle and publication activation.
    // Two independent queries could admit a revoked row using a later state.
    const [found] = await this.db().select({ admission: pluginMarketplaceAdmissions })
      .from(pluginMarketplaceAdmissions)
      .innerJoin(plugins, eq(plugins.id, pluginMarketplaceAdmissions.pluginId))
      .leftJoin(pluginMarketplacePublisherRevocations, eq(
        pluginMarketplacePublisherRevocations.publisherId,
        pluginMarketplaceAdmissions.publisherId,
      ))
      .innerJoin(pluginPublicationStates, and(
        eq(pluginPublicationStates.pluginId, pluginMarketplaceAdmissions.pluginId),
        eq(pluginPublicationStates.publicationId, publicationId),
        eq(pluginPublicationStates.enabled, true),
      ))
      .where(and(
        eq(pluginMarketplaceAdmissions.pluginId, pluginId),
        eq(pluginMarketplaceAdmissions.revoked, false),
        isNull(pluginMarketplacePublisherRevocations.publisherId),
        eq(plugins.status, "active"),
      )).limit(1);
    if (!found) return null;
    const admission = parseRow(found.admission);
    return admission.approvedPublicationIds?.includes(publicationId) ? admission : null;
  }

  /**
   * Only an already-authorized offline operator may call this. New rows use
   * expectedRevision=0; updates require exact CAS and cannot resurrect a
   * previously revoked approval. Separate security approval is required for
   * a new signed release after revocation.
   */
  async approveOperatorRelease(
    input: unknown,
    expectedRevision: number,
    audit: MarketplaceOperatorAudit,
  ): Promise<AuthoritativePluginAdmission> {
    ensureOperatorAudit(audit);
    const admission = parseDurableMarketplaceAdmission(input);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_INVALID");
    }
    return this.db().transaction(async (tx) => {
      // Serialize approvals with publisher-wide revocation using the SAME
      // transaction advisory lock; no approval may race past its tombstone.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${admission.publisherId}, 0))`);
      const [publisherRevocation] = await tx.select({
        publisherId: pluginMarketplacePublisherRevocations.publisherId,
      }).from(pluginMarketplacePublisherRevocations).where(eq(
        pluginMarketplacePublisherRevocations.publisherId, admission.publisherId,
      )).limit(1);
      if (publisherRevocation) {
        throw new MarketplaceAdmissionError("MARKETPLACE_PUBLISHER_REVOKED");
      }
      const [plugin] = await tx.select({ id: plugins.id, status: plugins.status })
        .from(plugins).where(eq(plugins.id, admission.pluginId)).for("update").limit(1);
      if (!plugin || plugin.status !== "active") {
        throw new MarketplaceAdmissionError("MARKETPLACE_PLUGIN_NOT_ACTIVE");
      }
      const states = await tx.select({ publicationId: pluginPublicationStates.publicationId })
        .from(pluginPublicationStates).where(and(
          eq(pluginPublicationStates.pluginId, admission.pluginId),
          inArray(pluginPublicationStates.publicationId, admission.approvedPublicationIds),
          eq(pluginPublicationStates.enabled, true),
        ));
      if (states.length !== admission.approvedPublicationIds.length) {
        throw new MarketplaceAdmissionError("MARKETPLACE_PUBLICATION_NOT_ACTIVE");
      }
      const [prior] = await tx.select().from(pluginMarketplaceAdmissions)
        .where(eq(pluginMarketplaceAdmissions.pluginId, admission.pluginId))
        .for("update").limit(1);
      if ((prior?.policyRevision ?? 0) !== expectedRevision) {
        throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_CONFLICT");
      }
      if (prior?.revoked) {
        throw new MarketplaceAdmissionError("MARKETPLACE_REVOKED_CANNOT_REACTIVATE");
      }
      const policyRevision = expectedRevision + 1;
      if (!Number.isSafeInteger(policyRevision)) {
        throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_EXHAUSTED");
      }
      if (prior) {
        await tx.update(pluginMarketplaceAdmissions)
          .set({
            publisherId: admission.publisherId,
            policyRevision,
            admission,
            revoked: false,
            updatedAt: new Date(),
          })
          .where(eq(pluginMarketplaceAdmissions.pluginId, admission.pluginId));
      } else {
        await tx.insert(pluginMarketplaceAdmissions).values({
          pluginId: admission.pluginId,
          publisherId: admission.publisherId,
          policyRevision,
          admission,
          revoked: false,
        });
      }
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        publicationId: null,
        actorUserId: audit.actorUserId,
        requestId: audit.requestId,
        action: "plugin.marketplace_admission_approved",
        targetType: "plugin",
        targetId: admission.pluginId,
        metadata: { policyRevision, releaseDigest: admission.releaseDigest },
      });
      return { ...admission, policyRevision, isRevoked: false };
    });
  }

  /**
   * Globally revoke a publisher. The tombstone persists even if all plugins
   * are uninstalled, preventing a later approval of a different plugin ID.
   * An ordinary operator cannot reset the tombstone through this repository.
   */
  async revokeOperatorPublisher(
    publisherId: string,
    audit: MarketplaceOperatorAudit,
    reason?: string,
  ): Promise<number> {
    ensureOperatorAudit(audit);
    if (!publisherId.trim() || publisherId.length > 256) {
      throw new MarketplaceAdmissionError("MARKETPLACE_PUBLISHER_INVALID");
    }
    return this.db().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${publisherId}, 0))`);
      const [created] = await tx.insert(pluginMarketplacePublisherRevocations).values({
        publisherId,
        reason: reason?.slice(0, 256) ?? null,
        operatorUserId: audit.actorUserId,
      }).onConflictDoNothing().returning({
        publisherId: pluginMarketplacePublisherRevocations.publisherId,
      });
      if (!created) return 0;
      const existing = await tx.select({
        pluginId: pluginMarketplaceAdmissions.pluginId,
        policyRevision: pluginMarketplaceAdmissions.policyRevision,
      }).from(pluginMarketplaceAdmissions).where(and(
        eq(pluginMarketplaceAdmissions.publisherId, publisherId),
        eq(pluginMarketplaceAdmissions.revoked, false),
      )).orderBy(pluginMarketplaceAdmissions.pluginId).for("update");
      for (const row of existing) {
        const next = row.policyRevision + 1;
        if (!Number.isSafeInteger(next)) {
          throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_EXHAUSTED");
        }
        await tx.update(pluginMarketplaceAdmissions).set({
          revoked: true, policyRevision: next, updatedAt: new Date(),
        }).where(eq(pluginMarketplaceAdmissions.pluginId, row.pluginId));
      }
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: "plugin.marketplace_publisher_revoked",
        targetType: "plugin_publisher", targetId: publisherId,
        metadata: { affectedPluginCount: existing.length },
      });
      return existing.length;
    });
  }

  /** Durable, idempotent operator revocation; existing approvals stay revoked. */
  async revokeOperatorRelease(
    pluginId: string,
    expectedRevision: number,
    audit: MarketplaceOperatorAudit,
  ): Promise<number> {
    ensureOperatorAudit(audit);
    return this.db().transaction(async (tx) => {
      const [row] = await tx.select().from(pluginMarketplaceAdmissions)
        .where(eq(pluginMarketplaceAdmissions.pluginId, pluginId)).for("update").limit(1);
      if (!row || row.policyRevision !== expectedRevision) {
        throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_CONFLICT");
      }
      if (row.revoked) return row.policyRevision;
      const policyRevision = row.policyRevision + 1;
      if (!Number.isSafeInteger(policyRevision)) {
        throw new MarketplaceAdmissionError("MARKETPLACE_REVISION_EXHAUSTED");
      }
      await tx.update(pluginMarketplaceAdmissions)
        .set({ revoked: true, policyRevision, updatedAt: new Date() })
        .where(eq(pluginMarketplaceAdmissions.pluginId, pluginId));
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: "plugin.marketplace_admission_revoked",
        targetType: "plugin", targetId: pluginId,
        metadata: { policyRevision },
      });
      return policyRevision;
    });
  }
}
