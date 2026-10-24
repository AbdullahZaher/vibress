import { verifyOperatorReleaseAdmission } from "../../apps/api/src/plugins/operator-release-preflight";

/**
 * Offline operator command; run on trusted staging and on each API/Worker
 * release mount. The output is a path/secret-free, comparable JSON receipt.
 * Unreviewed packages, unsigned v1 files and partial replicas fail closed.
 */
async function main() {
  const args = process.argv.slice(2);
  const lockfile = process.env.VIBRESS_TRUSTED_PLUGIN_LOCKFILE;
  if (!lockfile) throw new Error("MISSING_TRUSTED_RELEASE_LOCKFILE");
  let expected: string | undefined;
  if (args.length !== 0) {
    if (args.length !== 2 || args[0] !== "--expected-lockfile-sha256") {
      throw new Error("INVALID_ADMISSION_ARGUMENTS");
    }
    expected = args[1];
  }
  const receipt = await verifyOperatorReleaseAdmission(lockfile, expected);
  process.stdout.write(JSON.stringify(receipt) + "\n");
}

void main().catch(() => {
  // Do not print operator paths, attestation keys or attacker-owned messages.
  console.error("Operator release admission failed; do not deploy or activate");
  process.exitCode = 1;
});
