import {
  assertPluginReplicaConsensus, type PluginReplicaReceipt,
} from "./replica-receipt-consistency";

/**
 * PLUG-UPD-03: read-only correlated evidence for the INSTALLED source release.
 * This is a snapshot check, not signer verification, runtime attestation,
 * a distributed lock, or authorization to move the plan to "quiesced".
 */
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLUGIN = /^[a-z0-9][a-z0-9-]{0,99}$/;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSnapshot(raw: unknown) {
  if (!object(raw) || typeof raw.planId !== "string" || !UUID.test(raw.planId) ||
      typeof raw.pluginId !== "string" || !UUID.test(raw.pluginId) ||
      typeof raw.manifestId !== "string" || !PLUGIN.test(raw.manifestId) ||
      raw.status !== "approved" ||
      typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) ||
      raw.revision <= 0 ||
      typeof raw.planSha256 !== "string" || !SHA.test(raw.planSha256) ||
      typeof raw.fromVersion !== "string" || raw.fromVersion.length < 1 ||
      raw.fromVersion.length > 128 ||
      typeof raw.fromArtifactSha256 !== "string" || !SHA.test(raw.fromArtifactSha256) ||
      typeof raw.fromLockfileSha256 !== "string" || !SHA.test(raw.fromLockfileSha256) ||
      typeof raw.fromSignerSha256 !== "string" || !SHA.test(raw.fromSignerSha256) ||
      typeof raw.installedVersion !== "string" || raw.installedVersion.length < 1 ||
      raw.installedVersion.length > 128 ||
      typeof raw.installedManifestId !== "string" ||
      (raw.installedStatus !== "inactive" && raw.installedStatus !== "registered") ||
      typeof raw.hasEnabledPublications !== "boolean" ||
      typeof raw.hasUnsettledReceipts !== "boolean" ||
      typeof raw.hasActiveRedisJobs !== "boolean") {
    throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_SNAPSHOT");
  }
  return {
    manifestId: raw.manifestId, fromVersion: raw.fromVersion,
    fromArtifactSha256: raw.fromArtifactSha256,
    fromLockfileSha256: raw.fromLockfileSha256,
    fromSignerSha256: raw.fromSignerSha256,
    installedVersion: raw.installedVersion,
    installedManifestId: raw.installedManifestId,
    hasEnabledPublications: raw.hasEnabledPublications,
    hasUnsettledReceipts: raw.hasUnsettledReceipts,
    hasActiveRedisJobs: raw.hasActiveRedisJobs,
  };
}

/** Fixed output: no identities, tenant data or event payloads. */
export function assessUpgradeSourceFleet(
  snapshot: unknown, replicas: readonly PluginReplicaReceipt[],
): { readonly apiReplicas: number; readonly workerReplicas: number;
      readonly approvedSource: boolean; readonly idleSnapshot: true } {
  const state = parseSnapshot(snapshot);
  if (state.installedManifestId !== state.manifestId ||
      state.installedVersion !== state.fromVersion) {
    throw new Error("PLUGIN_UPGRADE_FLEET_STALE_INSTALLED_RELEASE");
  }
  if (state.hasEnabledPublications || state.hasUnsettledReceipts ||
      state.hasActiveRedisJobs) {
    throw new Error("PLUGIN_UPGRADE_FLEET_NOT_DRAINED");
  }

  // Reuse exactly the existing independent-replica comparator, including
  // distinct 2x API + 2x Worker identities and full signed inventory match.
  const consensus = assertPluginReplicaConsensus(replicas, {
    lockfileSha256: state.fromLockfileSha256,
    publicKeySha256: state.fromSignerSha256,
  });
  for (const input of replicas) {
    // The shared comparator already verified the full signed-receipt
    // structure; only extract the source release after its success.
    if (!object(input.receipt) || !Array.isArray(input.receipt.releases)) {
      throw new Error("PLUGIN_UPGRADE_FLEET_RELEASE_MISMATCH");
    }
    const matches = (input.receipt.releases as unknown[]).filter(
      (release) => object(release) && release.pluginId === state.manifestId,
    );
    const release = matches[0];
    if (matches.length !== 1 || !object(release) ||
        release.version !== state.fromVersion ||
        release.sha256 !== state.fromArtifactSha256) {
      throw new Error("PLUGIN_UPGRADE_FLEET_RELEASE_MISMATCH");
    }
  }
  return {
    apiReplicas: consensus.apiReplicas,
    workerReplicas: consensus.workerReplicas,
    approvedSource: true,
    idleSnapshot: true,
  };
}
