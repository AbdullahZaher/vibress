import { verifyTrustedPluginRelease, verifyOperatorReleaseAdmission } from "../../apps/api/src/plugins/operator-release-preflight";

/** Run on every API replica using its own mounted trusted release before deployment.
 * Nothing is imported/executed from the untrusted artifact paths. */
async function main() {
  const lockfile = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  const policy = process.env.VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY;
  if (policy !== undefined && policy !== "strict") {
    throw new Error("Unsupported trusted plugin admission policy");
  }
  if (!lockfile) {
    if (process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1" ||
        policy === "strict") {
      throw new Error("Trusted plugin release mount required");
    }
    console.info("External plugin preflight: bundled-only mode");
    return;
  }
  const releases = policy === "strict"
    ? (await verifyOperatorReleaseAdmission(lockfile,
        process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256)).releases
    : await verifyTrustedPluginRelease(lockfile);
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
