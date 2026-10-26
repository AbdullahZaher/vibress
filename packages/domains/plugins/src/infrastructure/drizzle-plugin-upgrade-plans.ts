import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, plugins, pluginUpgradePlans } from "@vibress/database";
import {
  PluginUpgradePlanError, preparePluginUpgradeStage,
  type OperatorUpgradeStageInput,
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
  async stage(input: OperatorUpgradeStageInput) {
    return getDb().transaction(async (tx) => {
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
}
