import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseTrustedPluginLockfile } from "./trusted-external-plugin-host";

const MAX_LOCKFILE_BYTES = 128 * 1024;
const MAX_MODULE_BYTES = 8 * 1024 * 1024;
const MAX_ADMIN_HTML_BYTES = 256 * 1024;

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
  if (!path.isAbsolute(lockfilePath)) throw new Error("INVALID_LOCKFILE_PATH");
  const lockInfo = await lstat(lockfilePath);
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink() ||
      lockInfo.size > MAX_LOCKFILE_BYTES) throw new Error("INVALID_LOCKFILE");
  const input: unknown = JSON.parse(await readFile(lockfilePath, "utf8"));
  const admitted = parseTrustedPluginLockfile(input);
  const root = await realpath(path.dirname(lockfilePath));

  async function verifyFile(relative: string, digest: string, maxSize: number) {
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
    const bytes = await readFile(canonical);
    if (bytes.byteLength > maxSize ||
        createHash("sha256").update(bytes).digest("hex") !== digest) {
      throw new Error("APPROVED_ARTIFACT_MISMATCH");
    }
  }

  const result: VerifiedExternalRelease[] = [];
  for (const approved of admitted.values()) {
    await verifyFile(approved.manifest.entrypoint, approved.sha256, MAX_MODULE_BYTES);
    for (const asset of approved.adminUiAssets) {
      await verifyFile(asset.path, asset.sha256, MAX_ADMIN_HTML_BYTES);
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
