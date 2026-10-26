import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  getDb, plugins, pluginUpgradePlans, pluginPublicationStates,
  pluginEventReceipts, auditEvents,
} from "@vibress/database";
import {
  PluginUpgradePlanError, preparePluginUpgradeStage, validateOperatorUpgradeAbort,
  validateOperatorUpgradePreflight, validateOperatorUpgradeApproval,
  type OperatorUpgradeStageInput, type OperatorUpgradeAbortInput,
  type OperatorUpgradePreflightInput, type OperatorUpgradeApprovalInput,
  type OperatorUpgradeAuditContext,
} from "../application/plugin-upgrade-plan";

/**
 * Offline operator-only staging. The caller MUST have independently checked
 * BOTH signed mounts using verifyOperatorReleaseAdmission() and must use the
 * installed source release currently running on the approved fleet.
 *
 * Never expose this directly to Admin/public/member/plugin SDK routes.
 * Stage does not change plugin metadata, jobs, permissions, or runtime.
 */
export class DrizzlePluginUpgradePlanRepository {
  constructor(private readonly db: () => ReturnType<typeof getDb> = getDb) {}

  async stage(input: OperatorUpgradeStageInput) {
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version, capabilities: plugins.capabilities,
      }).from(plugins).where(eq(plugins.id, input.pluginId)).for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const stage = preparePluginUpgradeStage(input, installed);
      const [existing] = await tx.select({ id: pluginUpgradePlans.id })
        .from(pluginUpgradePlans).where(and(
          eq(pluginUpgradePlans.pluginId, installed.id),
          notInArray(pluginUpgradePlans.status, ["aborted", "completed"]),
        )).limit(1);
      if (existing) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PLAN_EXISTS");
      const [created] = await tx.insert(pluginUpgradePlans).values({
        id: randomUUID(),
        pluginId: installed.id,
        manifestId: stage.manifestId,
        fromVersion: stage.fromVersion, toVersion: stage.toVersion,
        fromArtifactSha256: stage.fromArtifactSha256,
        toArtifactSha256: stage.toArtifactSha256,
        fromLockfileSha256: stage.fromLockfileSha256,
        toLockfileSha256: stage.toLockfileSha256,
        fromSignerSha256: stage.fromSignerSha256,
        toSignerSha256: stage.toSignerSha256,
        capabilitiesAdded: [...stage.capabilitiesAdded],
        capabilitiesRemoved: [...stage.capabilitiesRemoved],
        planSha256: stage.planSha256,
        status: "staged",
      }).onConflictDoNothing().returning();
      if (!created) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PLAN_EXISTS");
      return created;
    });
  }


  /**
   * PLUG-UPD-02B: a locked, read-only readiness evaluation followed by a
   * durable staged -> preflighted CAS and audit in the same transaction.
   * Preflight is intentionally conservative: it requires the globally
   * installed plugin to be inactive, all publications disabled, and no
   * outstanding events for that plugin. It is NOT fleet-drain acceptance.
   */
  async preflight(
    input: OperatorUpgradePreflightInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradePreflight(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version, status: plugins.status,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "staged" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      }
      if (!["inactive", "registered"].includes(installed.status)) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PREFLIGHT_NOT_READY");
      }
      const [enabled] = await tx.select({ pluginId: pluginPublicationStates.pluginId })
        .from(pluginPublicationStates).where(and(
          eq(pluginPublicationStates.pluginId, installed.id),
          eq(pluginPublicationStates.enabled, true),
        )).limit(1);
      const [pending] = await tx.select({ id: pluginEventReceipts.id })
        .from(pluginEventReceipts).where(and(
          eq(pluginEventReceipts.pluginId, installed.id),
          inArray(pluginEventReceipts.status, ["pending", "dispatching", "queued"]),
        )).limit(1);
      if (enabled || pending) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PREFLIGHT_NOT_READY");
      }
      // This fingerprint is a DB-readiness snapshot of pinned identities.
      // It is NOT a signed replica receipt or approval to execute migrations.
      const preflightSha256 = createHash("sha256").update(JSON.stringify([
        plan.id, plan.pluginId, plan.planSha256, plan.revision,
        plan.fromArtifactSha256, plan.toArtifactSha256,
        plan.fromLockfileSha256, plan.toLockfileSha256,
        plan.fromSignerSha256, plan.toSignerSha256,
        installed.version, installed.status,
      ])).digest("hex");
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "preflighted", preflightSha256,
        preflightedAt: new Date(),
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "staged"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_PREFLIGHT_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_preflighted",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * Explicit operator approval records intent, never execution authority.
   * Requires a fresh revision, exact signed-release plan pin, saved preflight
   * digest and review of the declared capability additions/removals.
   * The absence of a fleet attestation still prohibits actual activation.
   */
  async approve(
    input: OperatorUpgradeApprovalInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeApproval(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version, status: plugins.status,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "preflighted" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.preflightSha256 !== checked.input.expectedPreflightSha256 ||
          !plan.preflightedAt ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version ||
          JSON.stringify(plan.capabilitiesAdded) !==
            JSON.stringify([...checked.input.reviewedCapabilitiesAdded]) ||
          JSON.stringify(plan.capabilitiesRemoved) !==
            JSON.stringify([...checked.input.reviewedCapabilitiesRemoved])) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      }
      // The preflighted receipt can become stale before approval. Recheck
      // DB state here; this alone does not fence running worker processes.
      if (!["inactive", "registered"].includes(installed.status)) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_APPROVAL_NOT_READY");
      }
      const [enabled] = await tx.select({ pluginId: pluginPublicationStates.pluginId })
        .from(pluginPublicationStates).where(and(
          eq(pluginPublicationStates.pluginId, installed.id),
          eq(pluginPublicationStates.enabled, true),
        )).limit(1);
      const [pending] = await tx.select({ id: pluginEventReceipts.id })
        .from(pluginEventReceipts).where(and(
          eq(pluginEventReceipts.pluginId, installed.id),
          inArray(pluginEventReceipts.status, ["pending", "dispatching", "queued"]),
        )).limit(1);
      if (enabled || pending) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_APPROVAL_NOT_READY");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "approved", approvedAt: new Date(),
        approvedBy: checked.audit.actorUserId,
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "preflighted"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
        eq(pluginUpgradePlans.preflightSha256, checked.input.expectedPreflightSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_APPROVAL_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_approved",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-02A: abort ONLY an unapproved, unexecuted staged plan.
   * Does not delete history, reverse migrations or mutate the plugin runtime.
   * Both plugin and plan are locked; the optimistic revision and immutable
   * pin guard concurrent or stale operator requests. Audit shares the
   * transaction and rolls back the abort if the audit write fails.
   *
   * Operator authorization must be established by the trusted caller.
   * Never expose this repository to external plugin code or HTTP handlers.
   */
  async abortStaged(
    input: OperatorUpgradeAbortInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeAbort(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");

      const [plan] = await tx.select({
        id: pluginUpgradePlans.id,
        status: pluginUpgradePlans.status,
        revision: pluginUpgradePlans.revision,
        planSha256: pluginUpgradePlans.planSha256,
        manifestId: pluginUpgradePlans.manifestId,
        fromVersion: pluginUpgradePlans.fromVersion,
      }).from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan ||
          plan.status !== "staged" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version) {
        // One indistinguishable failure for wrong plugin, stale pin/revision,
        // active upgrade, or a release changed after staging.
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_CONFLICT");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "aborted",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "staged"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_aborted",
        targetType: "plugin_upgrade_plan",
        targetId: updated.id,
        // No key material, artifact paths, tenant data or event payloads.
      });
      return updated;
    });
  }
}
