import { z } from "zod";
import {
  assertPluginReplicaConsensus, type PluginReplicaReceipt,
} from "./replica-receipt-consistency";

/**
 * PLUG-UPD-03: read-only correlated evidence for the INSTALLED source release.
 * This is a snapshot check, not a fleet lock, signer verification, runtime
 * attestation, or authorization to move an upgrade to "quiesced".
 */
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({
  planId: z.string().uuid(),
  pluginId: z.string().uuid(),
  manifestId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  status: z.literal("approved"),
  revision: z.number().int().positive(),
  planSha256: sha,
  fromVersion: z.string().min(1).max(128),
  fromArtifactSha256: sha,
  fromLockfileSha256: sha,
  fromSignerSha256: sha,
  installedVersion: z.string().min(1).max(128),
  installedManifestId: z.string().min(1).max(100),
  installedStatus: z.enum(["inactive", "registered"]),
  hasEnabledPublications: z.boolean(),
  hasUnsettledReceipts: z.boolean(),
  hasActiveRedisJobs: z.boolean(),
}).strict();
const admission = z.object({
  schemaVersion: z.literal(1),
  signatureVerified: z.literal(true),
  lockfileSha256: sha,
  publicKeySha256: sha,
  releases: z.array(z.object({
    pluginId: z.string(), version: z.string(),
    sha256: sha, adminViewCount: z.number().int().nonnegative(),
  })).min(1).max(64),
}).strict();

export function assessUpgradeSourceFleet(
  snapshot: unknown, replicas: readonly PluginReplicaReceipt[],
): { readonly apiReplicas: number; readonly workerReplicas: number;
      readonly approvedSource: boolean; readonly idleSnapshot: true } {
  const parsed = source.safeParse(snapshot);
  if (!parsed.success) throw new Error("PLUGIN_UPGRADE_FLEET_INVALID_SNAPSHOT");
  const state = parsed.data;
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
    const admitted = admission.safeParse(input.receipt);
    if (!admitted.success) throw new Error("PLUGIN_UPGRADE_FLEET_RELEASE_MISMATCH");
    const matches = admitted.data.releases.filter(
      (release) => release.pluginId === state.manifestId,
    );
    if (matches.length !== 1 ||
        matches[0]?.version !== state.fromVersion ||
        matches[0]?.sha256 !== state.fromArtifactSha256) {
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
