import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import {
  getDb, closeDbPool, plugins, pluginUpgradePlans,
  pluginPublicationStates, pluginEventReceipts, and, eq, inArray,
} from "@vibress/database";
import { Queue, QUEUE_NAMES, getBullMqRedisConnection } from "@vibress/queue";
import type { PluginWorkerEventJob } from "@vibress/api-contracts";
import type { PluginReplicaReceipt } from "./replica-receipt-consistency";
import { assessUpgradeSourceFleet } from "./upgrade-source-fleet";

/**
 * Operator-only, read-only M2 source fleet snapshot. It NEVER advances a plan
 * status or grants quiesce/migration/activation authority. A successful output
 * is not proof of a durable fleet lock or provenance of supplied files.
 */
async function receiptFile(filename: string): Promise<unknown> {
  if (!isAbsolute(filename)) throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_FILE");
  const handle = await open(resolve(filename),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > 256 * 1024) {
      throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_FILE");
    }
    const bytes = await handle.readFile();
    if (bytes.length > 256 * 1024) throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_FILE");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}
async function main() {
  if (process.env.VIBRESS_PLUGIN_UPGRADE_MAINTENANCE !== "1" ||
      process.env.VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY !== "strict" ||
      process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE !== "1") {
    throw new Error("PLUGIN_UPGRADE_FLEET_MAINTENANCE_REQUIRED");
  }
  const args = process.argv.slice(2);
  const planId = args.shift();
  if (!planId || !/^[a-f0-9-]{36}$/.test(planId) ||
      args.length < 4 || args.length > 128) {
    throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_ARGS");
  }
  const replicas: PluginReplicaReceipt[] = [];
  for (const arg of args) {
    const match = /^(api|worker):([a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})=(.+)$/.exec(arg);
    if (!match) throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_ARGS");
    replicas.push({
      role: match[1] === "api" ? "api" : "worker",
      replica: match[2] ?? "",
      receipt: await receiptFile(match[3] ?? ""),
    });
  }

  const db = getDb();
  const [plan] = await db.select().from(pluginUpgradePlans)
    .where(eq(pluginUpgradePlans.id, planId)).limit(1);
  if (!plan) throw new Error("PLUGIN_UPGRADE_FLEET_PLAN_NOT_FOUND");
  const [installed] = await db.select({
    id: plugins.id, manifestId: plugins.manifestId,
    version: plugins.version, status: plugins.status,
  }).from(plugins).where(eq(plugins.id, plan.pluginId)).limit(1);
  if (!installed) throw new Error("PLUGIN_UPGRADE_FLEET_PLAN_NOT_FOUND");

  const queue = new Queue<PluginWorkerEventJob>(QUEUE_NAMES.PLUGIN_EVENTS, {
    connection: getBullMqRedisConnection(),
  });
  try {
    await queue.waitUntilReady();
    // Global-queue empty is conservative: another plugin's job may block this
    // snapshot rather than falsely asserting all consumers are drained.
    const counts = await queue.getJobCounts(
      "waiting", "active", "delayed", "paused", "prioritized", "waiting-children",
    );
    const [enabled] = await db.select({ id: pluginPublicationStates.pluginId })
      .from(pluginPublicationStates).where(and(
        eq(pluginPublicationStates.pluginId, plan.pluginId),
        eq(pluginPublicationStates.enabled, true),
      )).limit(1);
    const [unsettled] = await db.select({ id: pluginEventReceipts.id })
      .from(pluginEventReceipts).where(and(
        eq(pluginEventReceipts.pluginId, plan.pluginId),
        inArray(pluginEventReceipts.status, ["pending", "dispatching", "queued"]),
      )).limit(1);
    // Reject if configured operator pins do not match the persisted source.
    if (process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256 !==
          plan.fromLockfileSha256 ||
        process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256 !==
          plan.fromSignerSha256) {
      throw new Error("PLUGIN_UPGRADE_FLEET_PINS_CHANGED");
    }
    const verdict = assessUpgradeSourceFleet({
      planId: plan.id, pluginId: plan.pluginId,
      manifestId: plan.manifestId, status: plan.status,
      revision: plan.revision, planSha256: plan.planSha256,
      fromVersion: plan.fromVersion,
      fromArtifactSha256: plan.fromArtifactSha256,
      fromLockfileSha256: plan.fromLockfileSha256,
      fromSignerSha256: plan.fromSignerSha256,
      installedVersion: installed.version,
      installedManifestId: installed.manifestId,
      installedStatus: installed.status,
      hasEnabledPublications: Boolean(enabled),
      hasUnsettledReceipts: Boolean(unsettled),
      hasActiveRedisJobs: Object.values(counts).some((count) => count !== 0),
    }, replicas);
    // No plugin identifiers, tenant IDs, receipt payloads or file paths.
    process.stdout.write(JSON.stringify(verdict) + "\n");
  } finally {
    await queue.close();
  }
}
void main().catch(() => {
  console.error("Upgrade source-fleet snapshot rejected; do not quiesce or activate");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
