import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { verifyTrustedPluginRelease, type VerifiedExternalRelease } from "./operator-release-preflight";
import { parseTrustedPluginLockfile } from "./trusted-external-plugin-host";
import { readTrustedPluginLockfileWithVerification } from "./trusted-release-attestation";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_LOCKFILE_BYTES = 128 * 1024;

/**
 * P0-3: offline operator-only admission, not a public HTTP or plugin SDK API.
 * This refuses unsigned packages even though old runtime v1 lockfiles continue
 * to work outside this new release-admission workflow.
 */
export interface OperatorReleaseAdmissionReceipt {
  readonly schemaVersion: 1;
  readonly lockfileSha256: string;
  readonly signatureVerified: true;
  readonly publicKeySha256: string;
  readonly releases: readonly VerifiedExternalRelease[];
}

async function lockfileDigest(lockfilePath: string): Promise<string> {
  if (!path.isAbsolute(lockfilePath)) throw new Error("INVALID_LOCKFILE_PATH");
  const file = await open(lockfilePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_LOCKFILE_BYTES) {
      throw new Error("INVALID_LOCKFILE");
    }
    const bytes = await file.readFile();
    if (bytes.length > MAX_LOCKFILE_BYTES) throw new Error("INVALID_LOCKFILE");
    return createHash("sha256").update(bytes).digest("hex");
  } finally {
    await file.close();
  }
}

/**
 * Require a signed, immutable release with operator-reviewed evidence.
 * Compares full signed lockfile digests across deployment replicas. Each
 * replica still verifies its own mounted module/UI/evidence bytes.
 *
 * Does NOT download, build, import, execute, migrate, deploy, or activate code.
 * Call in a locked-down staging process, then again on every API/Worker replica.
 * The operator must freeze/mount the files read-only for the entire rollout.
 */
export async function verifyOperatorReleaseAdmission(
  lockfilePath: string,
  expectedLockfileSha256?: string,
): Promise<OperatorReleaseAdmissionReceipt> {
  if (expectedLockfileSha256 !== undefined &&
      !SHA256.test(expectedLockfileSha256)) {
    throw new Error("INVALID_EXPECTED_RELEASE_DIGEST");
  }

  const beforeDigest = await lockfileDigest(lockfilePath);
  if (expectedLockfileSha256 !== undefined &&
      beforeDigest !== expectedLockfileSha256) {
    throw new Error("OPERATOR_RELEASE_REPLICA_MISMATCH");
  }

  const { lockfile, signatureVerified, publicKeySha256 } =
    await readTrustedPluginLockfileWithVerification(lockfilePath);
  if (!signatureVerified || !publicKeySha256) throw new Error("OPERATOR_SIGNATURE_REQUIRED");
  const expectedKey = process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256;
  if (!expectedKey || !SHA256.test(expectedKey) || expectedKey !== publicKeySha256) {
    throw new Error("OPERATOR_TRUST_ROOT_MISMATCH");
  }

  const approved = parseTrustedPluginLockfile(lockfile);
  if (approved.size === 0) throw new Error("OPERATOR_RELEASE_EMPTY");

  for (const plugin of approved.values()) {
    // Mandatory for *new admissions*, not for legacy runtime lockfile v1.
    const release = plugin.release;
    if (!release?.sbom || !release.provenance || !release.securityReview) {
      throw new Error("OPERATOR_RELEASE_EVIDENCE_REQUIRED");
    }
    if (plugin.storageModels.length > 0 &&
        (release.migrationPlans?.length ?? 0) === 0) {
      throw new Error("OPERATOR_RELEASE_MIGRATION_REVIEW_REQUIRED");
    }
  }

  // Includes SHA-256 checks of ESM, Admin UI, SBOM, provenance and
  // release-bound declarative migration plans. Never imports plugin code.
  const releases = await verifyTrustedPluginRelease(lockfilePath);

  // Fail closed if an operator file changed while a release was being checked.
  const afterDigest = await lockfileDigest(lockfilePath);
  if (beforeDigest !== afterDigest) {
    throw new Error("OPERATOR_RELEASE_CHANGED_DURING_ADMISSION");
  }
  const finalApproval = await readTrustedPluginLockfileWithVerification(lockfilePath);
  if (!finalApproval.signatureVerified ||
      finalApproval.publicKeySha256 !== publicKeySha256 ||
      await lockfileDigest(lockfilePath) !== beforeDigest) {
    throw new Error("OPERATOR_RELEASE_CHANGED_DURING_ADMISSION");
  }

  return {
    schemaVersion: 1,
    lockfileSha256: beforeDigest,
    signatureVerified: true,
    publicKeySha256,
    releases: [...releases].sort((a, b) => a.pluginId.localeCompare(b.pluginId, "en")),
  };
}
