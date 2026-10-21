import { verifyTrustedPluginRelease } from "../../apps/api/src/plugins/operator-release-preflight";

/** Run separately on every API/Worker replica before a rolling deployment.
 * Nothing is imported/executed from the untrusted artifact paths. */
async function main() {
  const lockfile = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  if (!lockfile) {
    console.info("External plugin preflight: bundled-only mode");
    return;
  }
  const releases = await verifyTrustedPluginRelease(lockfile);
  for (const release of releases) {
    // Never print secrets, source paths, contents or environment values.
    console.info(
      `Approved ${release.pluginId}@${release.version}, sha256:${release.sha256} (${release.adminViewCount} UI assets)`,
    );
  }
  console.info(`Verified ${releases.length} operator-pinned plugin releases`);
}

void main().catch(() => {
  console.error("External plugin preflight rejected release; deployment must stop");
  process.exitCode = 1;
});
