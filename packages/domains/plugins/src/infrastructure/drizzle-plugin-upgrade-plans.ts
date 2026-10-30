import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  getDb, plugins, pluginUpgradePlans, pluginPublicationStates,
  pluginEventReceipts, auditEvents,
} from "@vibress/database";
import {
  PluginUpgradePlanError, preparePluginUpgradeStage, validateOperatorUpgradeAbort,
  validateOperatorUpgradePreflight, validateOperatorUpgradeApproval,
  validateOperatorUpgradeQuiesce, validateOperatorUpgradeMigrate,
  validateOperatorUpgradeActivate, validateOperatorUpgradeObserve,
  validateOperatorUpgradeComplete, validateOperatorUpgradeRollback,
  type OperatorUpgradeStageInput, type OperatorUpgradeAbortInput,
  type OperatorUpgradePreflightInput, type OperatorUpgradeApprovalInput,
  type OperatorUpgradeTransitionInput, type OperatorUpgradeAuditContext,
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
   * PLUG-UPD-02C / UPD-03: Live fleet quiescence and admission stops.
   * Requires plan to be approved, plugin inactive, all publications disabled,
   * and no active in-flight event receipts.
   */
  async quiesce(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeQuiesce(input, audit);
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
      if (!plan || plan.status !== "approved" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_QUIESCE_CONFLICT");
      }
      if (!["inactive", "registered"].includes(installed.status)) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_QUIESCE_NOT_READY");
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
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_QUIESCE_NOT_READY");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "quiesced",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "approved"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_QUIESCE_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_quiesced",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-04: Approved additive schema migration execution.
   * Requires quiesced status; runs migration runner if provided.
   */
  async migrate(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
    options?: { migrationRunner?: () => Promise<void> },
  ) {
    const checked = validateOperatorUpgradeMigrate(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "quiesced" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_MIGRATE_CONFLICT");
      }
      if (options?.migrationRunner) {
        await options.migrationRunner();
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "migrated",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "quiesced"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_MIGRATE_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_migrated",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-02E: Atomic plugin metadata activation.
   * Atomically updates plugins table version & capabilities, advances plan to activated.
   */
  async activate(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeActivate(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version, capabilities: plugins.capabilities,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "migrated" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.fromVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ACTIVATE_CONFLICT");
      }
      const currentCaps = Array.isArray(installed.capabilities) ? installed.capabilities : [];
      const removedSet = new Set(plan.capabilitiesRemoved || []);
      const nextCaps = Array.from(new Set([
        ...currentCaps.filter((c) => !removedSet.has(c)),
        ...(plan.capabilitiesAdded || []),
      ])).sort();

      await tx.update(plugins).set({
        version: plan.toVersion,
        capabilities: nextCaps,
        updatedAt: new Date(),
      }).where(eq(plugins.id, installed.id));

      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "activated",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "migrated"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ACTIVATE_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_activated",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-02F: Post-activation observation checkpoint.
   * Verifies installed release corresponds to plan.toVersion.
   */
  async observe(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeObserve(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "activated" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.toVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_OBSERVE_CONFLICT");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "observed",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "activated"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_OBSERVE_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_observed",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-02G: Final completion checkpoint.
   * Transitions observed plan to completed, liberating the active owner slot.
   */
  async complete(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeComplete(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");
      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan || plan.status !== "observed" ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId ||
          plan.toVersion !== installed.version) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_COMPLETE_CONFLICT");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "completed",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, "observed"),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_COMPLETE_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(), publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_completed",
        targetType: "plugin_upgrade_plan", targetId: updated.id,
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-02A: Abort an un-migrated plan (staged, preflighted, approved, quiesced).
   * Rejects abort after migrations have run to prevent silent DB corruption.
   */
  async abort(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
  ) {
    const checked = validateOperatorUpgradeAbort(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");

      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_CONFLICT");
      }
      if (["migrated", "activated", "observed"].includes(plan.status)) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_AFTER_MIGRATION_DENIED");
      }
      if (!["staged", "preflighted", "approved", "quiesced"].includes(plan.status)) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ABORT_CONFLICT");
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "aborted",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, plan.status),
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
      });
      return updated;
    });
  }

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
      });
      return updated;
    });
  }

  /**
   * PLUG-UPD-05: Controlled rollback of migrated or activated release.
   * Enforces irreversible migration boundary: refuses rollback without down-migration.
   */
  async rollback(
    input: OperatorUpgradeTransitionInput, audit: OperatorUpgradeAuditContext,
    options?: { hasIrreversibleMigrations?: boolean; downMigrationRunner?: () => Promise<void> },
  ) {
    const checked = validateOperatorUpgradeRollback(input, audit);
    return this.db().transaction(async (tx) => {
      const [installed] = await tx.select({
        id: plugins.id, manifestId: plugins.manifestId,
        version: plugins.version, capabilities: plugins.capabilities,
      }).from(plugins).where(eq(plugins.id, checked.input.pluginId))
        .for("update").limit(1);
      if (!installed) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_NOT_INSTALLED");

      const [plan] = await tx.select().from(pluginUpgradePlans).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
      )).for("update").limit(1);
      if (!plan ||
          !["migrated", "activated", "observed"].includes(plan.status) ||
          plan.revision !== checked.input.expectedRevision ||
          plan.planSha256 !== checked.input.expectedPlanSha256 ||
          plan.manifestId !== installed.manifestId) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ROLLBACK_CONFLICT");
      }
      if (options?.hasIrreversibleMigrations && !options?.downMigrationRunner) {
        throw new PluginUpgradePlanError("PLUGIN_UPGRADE_IRREVERSIBLE_MIGRATION");
      }
      if (options?.downMigrationRunner) {
        await options.downMigrationRunner();
      }
      if (plan.status === "activated" || plan.status === "observed") {
        const currentCaps = Array.isArray(installed.capabilities) ? installed.capabilities : [];
        const addedSet = new Set(plan.capabilitiesAdded || []);
        const revertedCaps = Array.from(new Set([
          ...currentCaps.filter((c) => !addedSet.has(c)),
          ...(plan.capabilitiesRemoved || []),
        ])).sort();

        await tx.update(plugins).set({
          version: plan.fromVersion,
          capabilities: revertedCaps,
          updatedAt: new Date(),
        }).where(eq(plugins.id, installed.id));
      }
      const [updated] = await tx.update(pluginUpgradePlans).set({
        status: "aborted",
        revision: sql`${pluginUpgradePlans.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(pluginUpgradePlans.id, checked.input.planId),
        eq(pluginUpgradePlans.pluginId, checked.input.pluginId),
        eq(pluginUpgradePlans.status, plan.status),
        eq(pluginUpgradePlans.revision, checked.input.expectedRevision),
        eq(pluginUpgradePlans.planSha256, checked.input.expectedPlanSha256),
      )).returning();
      if (!updated) throw new PluginUpgradePlanError("PLUGIN_UPGRADE_ROLLBACK_CONFLICT");
      await tx.insert(auditEvents).values({
        id: randomUUID(),
        publicationId: null,
        actorUserId: checked.audit.actorUserId,
        requestId: checked.audit.requestId,
        action: "plugin.upgrade_rolled_back",
        targetType: "plugin_upgrade_plan",
        targetId: updated.id,
      });
      return updated;
    });
  }
}
