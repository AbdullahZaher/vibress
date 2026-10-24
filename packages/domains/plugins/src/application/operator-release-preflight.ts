import { createHash } from "node:crypto";
import { lstat, realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import path from "node:path";
import { parseTrustedPluginLockfile } from "./trusted-external-plugin-host";
import { readTrustedPluginLockfile } from "./trusted-release-attestation";
import { checkOperatorPluginMigrationPlan } from "./operator-migration-plan-preflight";

const MAX_LOCKFILE_BYTES = 128 * 1024;
const MAX_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_ADMIN_HTML_BYTES = 256 * 1024;
const MAX_RELEASE_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_MIGRATION_PLAN_BYTES = 256 * 1024;
const securityReviewSchema = z.object({
  schemaVersion: z.literal(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewer: z.string().trim().min(1).max(120),
  scanner: z.string().trim().min(1).max(120),
  scannedAt: z.string().datetime({ offset: true }),
  criticalFindings: z.literal(0),
  highFindings: z.literal(0),
  decision: z.literal("approved"),
}).strict();

export interface VerifiedExternalRelease {
  readonly pluginId: string;
  readonly version: string;
  readonly sha256: string;
  readonly adminViewCount: number;
}

/** Before enabling a newly deployed release, verify every final byte on
 * this replica. No import/activate/eval occurs during this preflight. */
export async function verifyTrustedPluginRelease(
  lockfilePath: string,
): Promise<readonly VerifiedExternalRelease[]> {
  // Preserve the existing operator CLI error contract while the shared reader
  // independently rechecks bytes, signature, and size before admission.
  if (!path.isAbsolute(lockfilePath)) throw new Error("INVALID_LOCKFILE_PATH");
  const info = await lstat(lockfilePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LOCKFILE_BYTES) {
    throw new Error("INVALID_LOCKFILE");
  }
  const input = await readTrustedPluginLockfile(lockfilePath);
  const admitted = parseTrustedPluginLockfile(input);
  const root = await realpath(path.dirname(lockfilePath));

  async function verifyFile(
    relative: string, digest: string, maxSize: number,
    format: "binary" | "html" | "json" = "binary",
  ) {
    const resolved = path.resolve(root, relative);
    const canonical = await realpath(resolved);
    const withinRoot = path.relative(root, canonical);
    if (withinRoot.startsWith("..") || path.isAbsolute(withinRoot) ||
        withinRoot === "") throw new Error("ARTIFACT_PATH_REJECTED");
    const [linkInfo, realInfo] = await Promise.all([lstat(resolved), stat(canonical)]);
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile() ||
        !realInfo.isFile() || realInfo.size > maxSize) {
      throw new Error("INVALID_APPROVED_ARTIFACT");
    }
    // A checked inode is also the one read: no final-path symlink races.
    const file = await open(resolved,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.size > maxSize ||
          opened.dev !== realInfo.dev || opened.ino !== realInfo.ino) {
        throw new Error("INVALID_APPROVED_ARTIFACT");
      }
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
    if (bytes.byteLength > maxSize ||
        createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw new Error("APPROVED_ARTIFACT_MISMATCH");
    }
    if (format !== "binary") {
      const document = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (document.includes("\u0000")) throw new Error("INVALID_APPROVED_DOCUMENT");
      if (format === "json") {
        // This checks syntax, not SBOM/provenance truth or migration consent.
        const parsed: unknown = JSON.parse(document);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("INVALID_APPROVED_JSON");
        }
        return parsed;
      }
    }
    return undefined;
  }

  const result: VerifiedExternalRelease[] = [];
  for (const approved of admitted.values()) {
    await verifyFile(approved.manifest.entrypoint, approved.sha256, MAX_MODULE_BYTES);
    for (const asset of approved.adminUiAssets) {
      await verifyFile(asset.path, asset.sha256, MAX_ADMIN_HTML_BYTES, "html");
    }
    // Release evidence is pinned inert JSON, never imported or executed.
    for (const file of [approved.release?.sbom, approved.release?.provenance]) {
      if (file) await verifyFile(file.path, file.sha256, MAX_RELEASE_EVIDENCE_BYTES, "json");
    }
    if (approved.release?.securityReview) {
      const reviewed = await verifyFile(approved.release.securityReview.path,
        approved.release.securityReview.sha256, MAX_MIGRATION_PLAN_BYTES, "json");
      const parsed = securityReviewSchema.safeParse(reviewed);
      if (!parsed.success || parsed.data.artifactSha256 !== approved.sha256) {
        throw new Error("OPERATOR_SECURITY_REVIEW_REJECTED");
      }
    }
    for (const migration of approved.release?.migrationPlans ?? []) {
      const plan = await verifyFile(
        migration.path, migration.sha256, MAX_MIGRATION_PLAN_BYTES, "json",
      );
      const validated = checkOperatorPluginMigrationPlan(plan, {
        manifest: approved.manifest,
        sha256: approved.sha256,
        storageModels: approved.storageModels,
      });
      if (validated.migrationId !== migration.id) {
        throw new Error("PLUGIN_MIGRATION_RELEASE_MISMATCH");
      }
    }
    result.push({
      pluginId: approved.manifest.id,
      version: approved.manifest.version,
      sha256: approved.sha256,
      adminViewCount: approved.adminUiAssets.length,
    });
  }
  return result;
}
