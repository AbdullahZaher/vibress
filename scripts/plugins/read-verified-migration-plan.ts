/**
 * Operator-only signed migration-plan admission. Shared by read-only preflight
 * and explicit schema-apply commands; neither imports or executes plugin JS.
 */
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  checkOperatorPluginMigrationPlan,
  parseTrustedPluginLockfile,
  readTrustedPluginLockfile,
  verifyTrustedPluginRelease,
  type ApprovedPluginPhysicalMigration,
} from "@vibress/plugins";

const MAX_PLAN_BYTES = 64 * 1024;

/** Read the exact same bounded regular file descriptor we validated. */
export async function readBoundedOperatorMigrationPlanFile(planPath: string): Promise<unknown> {
  if (!path.isAbsolute(planPath)) throw new Error("Absolute operator migration plan required");
  // O_NOFOLLOW prevents a last-component symlink substitution; O_NONBLOCK
  // avoids waiting on a special device/FIFO before regular-file admission.
  const file = await open(planPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PLAN_BYTES) {
      throw new Error("Invalid bounded operator migration plan file");
    }
    const bytes = await file.readFile();
    if (!bytes.byteLength || bytes.byteLength > MAX_PLAN_BYTES) {
      throw new Error("Invalid operator migration plan size");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) throw new Error("Invalid migration plan text");
    const data: unknown = JSON.parse(text);
    return data;
  } finally {
    await file.close();
  }
}

export async function readVerifiedOperatorMigrationPlan(
  planPath: string,
  lockfilePath: string | undefined = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE,
): Promise<ApprovedPluginPhysicalMigration> {
  if (!path.isAbsolute(planPath) || !lockfilePath ||
      !path.isAbsolute(lockfilePath) ||
      process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE !== "1" ||
      !process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE ||
      !process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE) {
    throw new Error("Signed operator release and absolute migration plan are required");
  }
  const plan = await readBoundedOperatorMigrationPlanFile(planPath);

  // Verify ALL final approved bytes using the production preflight. Its
  // signature check is reused; never trust the extension's own checksum.
  const verified = await verifyTrustedPluginRelease(lockfilePath);
  const releases = parseTrustedPluginLockfile(
    await readTrustedPluginLockfile(lockfilePath),
  );
  if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
      !("manifestId" in plan) || typeof plan.manifestId !== "string") {
    throw new Error("Invalid operator migration plan");
  }
  const release = releases.get(plan.manifestId);
  if (!release || !verified.some((item) =>
    item.pluginId === release.manifest.id && item.version === release.manifest.version &&
    item.sha256 === release.sha256)) {
    throw new Error("Verified operator plugin release not found");
  }
  return checkOperatorPluginMigrationPlan(plan, release);
}
