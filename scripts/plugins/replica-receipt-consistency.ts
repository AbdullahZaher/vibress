/**
 * PLUG-OPS-01: compare the signed offline admission receipts captured on
 * independently verified API and Worker replicas. This is an evidence
 * correlation check, NOT a signature verifier, deployment coordinator, or
 * substitute for read-only release mounts / restart and drain drills.
 */
export interface PluginReplicaReceipt {
  readonly role: "api" | "worker";
  readonly replica: string;
  readonly receipt: unknown;
}

export interface PluginReplicaExpectedIdentity {
  readonly lockfileSha256: string;
  readonly publicKeySha256: string;
}

export interface PluginReplicaConsensus extends PluginReplicaExpectedIdentity {
  readonly schemaVersion: 1;
  readonly apiReplicas: number;
  readonly workerReplicas: number;
  readonly approvedReleases: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const REPLICA = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error("PLUGIN_REPLICA_RECEIPT_INVALID");
}

interface NormalizedRelease {
  pluginId: string;
  version: string;
  sha256: string;
  adminViewCount: number;
}

function readRelease(value: unknown): NormalizedRelease {
  if (!object(value) || typeof value.pluginId !== "string" ||
      !PLUGIN_ID.test(value.pluginId) || typeof value.version !== "string" ||
      value.version.length < 1 || value.version.length > 128 ||
      typeof value.sha256 !== "string" || !SHA256.test(value.sha256) ||
      typeof value.adminViewCount !== "number" ||
      !Number.isSafeInteger(value.adminViewCount) ||
      value.adminViewCount < 0 || value.adminViewCount > 1024) invalid();
  return {
    pluginId: value.pluginId,
    version: value.version,
    sha256: value.sha256,
    adminViewCount: value.adminViewCount,
  };
}

function readReceipt(value: unknown) {
  if (!object(value) || value.schemaVersion !== 1 ||
      value.signatureVerified !== true ||
      typeof value.lockfileSha256 !== "string" ||
      !SHA256.test(value.lockfileSha256) ||
      typeof value.publicKeySha256 !== "string" ||
      !SHA256.test(value.publicKeySha256) ||
      !Array.isArray(value.releases) || value.releases.length < 1 ||
      value.releases.length > 64) invalid();

  const releases: NormalizedRelease[] = value.releases.map((item: unknown) => readRelease(item));
  releases.sort((a, b) => a.pluginId.localeCompare(b.pluginId, "en"));
  if (new Set(releases.map((r) => r.pluginId)).size !== releases.length) invalid();
  return {
    lockfileSha256: value.lockfileSha256,
    publicKeySha256: value.publicKeySha256,
    releases,
  };
}

/**
 * Require evidence from two distinct API and two distinct Worker replicas.
 * For single-replica installations use the ordinary per-replica admission
 * command; this function deliberately enforces the M1A fleet drill.
 */
export function assertPluginReplicaConsensus(
  inputs: readonly PluginReplicaReceipt[],
  expected: PluginReplicaExpectedIdentity,
): PluginReplicaConsensus {
  if (!SHA256.test(expected.lockfileSha256) || !SHA256.test(expected.publicKeySha256) ||
      inputs.length < 4 || inputs.length > 128) {
    throw new Error("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
  }
  const seen = new Set<string>();
  let apiReplicas = 0;
  let workerReplicas = 0;
  let canonical: string | null = null;
  let releaseCount = 0;
  for (const input of inputs) {
    if ((input.role !== "api" && input.role !== "worker") ||
        !REPLICA.test(input.replica) || seen.has(`${input.role}:${input.replica}`)) {
      throw new Error("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
    }
    seen.add(`${input.role}:${input.replica}`);
    if (input.role === "api") apiReplicas++;
    else workerReplicas++;

    const receipt = readReceipt(input.receipt);
    if (receipt.lockfileSha256 !== expected.lockfileSha256 ||
        receipt.publicKeySha256 !== expected.publicKeySha256) {
      throw new Error("PLUGIN_REPLICA_IDENTITY_MISMATCH");
    }
    const snapshot = JSON.stringify(receipt);
    if (canonical !== null && snapshot !== canonical) {
      throw new Error("PLUGIN_REPLICA_IDENTITY_MISMATCH");
    }
    canonical = snapshot;
    releaseCount = receipt.releases.length;
  }
  if (apiReplicas < 2 || workerReplicas < 2) {
    throw new Error("PLUGIN_REPLICA_RECEIPTS_INCOMPLETE");
  }
  return {
    schemaVersion: 1,
    apiReplicas,
    workerReplicas,
    approvedReleases: releaseCount,
    lockfileSha256: expected.lockfileSha256,
    publicKeySha256: expected.publicKeySha256,
  };
}
