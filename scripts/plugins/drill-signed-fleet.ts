/**
 * PLUG-OPS-01/SEC-02: independent operator signature admission fixture on
 * a disposable CI runner. Four CHILD PROCESS validations, independent copied
 * mounts, and negative stale/revoked/altered release tests. Does not import
 * plugin code, contact a tenant DB, or pretend processes are production images.
 */
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertPluginReplicaConsensus, type PluginReplicaReceipt } from "./replica-receipt-consistency";

const SHA = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const requires = (ok: boolean, reason: string): void => {
  if (!ok) throw new Error(reason);
};
const instances = [
  { role: "api", replica: "api-a" },
  { role: "api", replica: "api-b" },
  { role: "worker", replica: "worker-a" },
  { role: "worker", replica: "worker-b" },
] as const;

if (process.env.GITHUB_ACTIONS !== "true" ||
    process.env.CI !== "true" ||
    process.env.VIBRESS_M1A_DISPOSABLE_DRILL !== "1" ||
    !/^[0-9]{1,20}$/.test(process.env.GITHUB_RUN_ID ?? "")) {
  throw new Error("PLUGIN_M1A_SIGNED_REPLICA_DRILL_REQUIRES_DISPOSABLE_CI");
}

const root = resolve(process.cwd());
const keys = generateKeyPairSync("ed25519");
const keyBytes = keys.publicKey.export({ format: "pem", type: "spki" });
const expectedKey = SHA(keys.publicKey.export({ format: "der", type: "spki" }));
const moduleBytes = Buffer.from('throw new Error("fixture module must never execute");\n', "utf8");
const reviewed = JSON.stringify({
  schemaVersion: 1, artifactSha256: SHA(moduleBytes),
  reviewer: "CI ephemeral operator", scanner: "reviewed fixture only",
  scannedAt: "2026-10-25T12:00:00Z", criticalFindings: 0,
  highFindings: 0, decision: "approved",
});
const sbom = JSON.stringify({ packages: [] });
const provenance = JSON.stringify({ buildType: "ephemeral CI fixture" });
const manifest = {
  id: "m1a-signed-fixture", name: "M1A Signed Fixture", version: "1.0.0",
  vibressApiVersion: "1.0.0", entrypoint: "dist/plugin.mjs",
  capabilities: ["events.subscribe"], hooks: ["post.published"],
};
const entry = {
  manifest, sha256: SHA(moduleBytes),
  release: {
    schemaVersion: 1,
    releaseId: `${manifest.id}@${manifest.version}:${SHA(moduleBytes)}`,
    publisher: { id: "ci-operator", name: "Isolated CI Operator" },
    compatibility: {
      minVibressApiVersion: "1.0.0", maxVibressApiVersion: "1.0.0",
      sdkAbiVersion: "1.0.0",
    },
    capabilities: manifest.capabilities,
    sbom: { path: "sbom.json", sha256: SHA(sbom) },
    provenance: { path: "provenance.json", sha256: SHA(provenance) },
    securityReview: { path: "security-review.json", sha256: SHA(reviewed) },
  },
};
const lockBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [entry] }));
const expectedLock = SHA(lockBytes);

type Fixture = { root: string; lock: string; module: string; signature: string };
async function createReplica(outer: string, replica: string): Promise<Fixture> {
  const dir = join(outer, replica);
  await mkdir(join(dir, "dist"), { recursive: true, mode: 0o700 });
  const fixture: Fixture = {
    root: dir, lock: join(dir, "trusted-plugins.json"),
    module: join(dir, "dist", "plugin.mjs"),
    signature: join(dir, "operator.sig"),
  };
  await Promise.all([
    writeFile(fixture.module, moduleBytes, { mode: 0o600 }),
    writeFile(join(dir, "sbom.json"), sbom, { mode: 0o600 }),
    writeFile(join(dir, "provenance.json"), provenance, { mode: 0o600 }),
    writeFile(join(dir, "security-review.json"), reviewed, { mode: 0o600 }),
    writeFile(fixture.lock, lockBytes, { mode: 0o600 }),
    writeFile(join(dir, "operator-public.pem"), keyBytes, { mode: 0o600 }),
    writeFile(fixture.signature, sign(null, lockBytes, keys.privateKey).toString("base64") + "\n",
      { mode: 0o600 }),
  ]);
  return fixture;
}
function admit(f: Fixture, overrides: Record<string, string> = {}): PluginReplicaReceipt["receipt"] {
  // Do not leak parent host release policies or external service credentials.
  // No secrets or signer PRIVATE KEY are supplied to the child process.
  const env = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
    NODE_ENV: "development",
    VIBRESS_TRUSTED_PLUGIN_ADMISSION_POLICY: "strict",
    VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE: "1",
    VIBRESS_TRUSTED_PLUGIN_LOCKFILE: f.lock,
    VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE: join(f.root, "operator-public.pem"),
    VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE: f.signature,
    VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: expectedKey,
    VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256: expectedLock,
    ...overrides,
  };
  const raw = execFileSync(process.execPath,
    ["--import=tsx", "scripts/plugins/admit.ts", "--expected-lockfile-sha256", expectedLock],
    { cwd: root, env, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw) as unknown;
}
function denied(f: Fixture, reason: string, overrides: Record<string, string> = {}): void {
  let rejected = false;
  try { admit(f, overrides); }
  catch { rejected = true; }
  requires(rejected, reason);
}
async function run(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "vibress-m1a-signed-fleet-"));
  try {
    const fixtures = await Promise.all(instances.map(inst => createReplica(dir, inst.replica)));
    const receipts = fixtures.map((fixture, index): PluginReplicaReceipt => ({
      role: instances[index]!.role, replica: instances[index]!.replica,
      receipt: admit(fixture),
    }));
    const consensus = assertPluginReplicaConsensus(receipts, {
      lockfileSha256: expectedLock, publicKeySha256: expectedKey,
    });
    requires(consensus.apiReplicas === 2 && consensus.workerReplicas === 2 &&
      consensus.approvedReleases === 1, "PLUGIN_M1A_FLEET_CONSENSUS_FAILED");
    console.info("PLUGIN_M1A_SIGNED_FLEET_STAGE: four independent signed admissions agree");

    // A formerly valid but now-revoked Ed25519 key cannot be admitted even
    // when release and signer pins still match exactly.
    denied(fixtures[0]!, "PLUGIN_M1A_REVOKED_SIGNER_ACCEPTED",
      { VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256: expectedKey });
    denied(fixtures[1]!, "PLUGIN_M1A_WRONG_TRUST_ROOT_ACCEPTED",
      { VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256: "b".repeat(64) });
    console.info("PLUGIN_M1A_SIGNED_FLEET_STAGE: revoked and wrong signer rejected");

    // Signed stale/mixed identity or modified plugin bytes must fail before
    // activation. Restore pristine bytes after negative check.
    const stale = fixtures[3]!;
    const changed = Buffer.from(JSON.stringify({
      schemaVersion: 1, plugins: [{ ...entry, manifest: { ...manifest, version: "1.0.1" } }],
    }));
    await writeFile(stale.lock, changed);
    await writeFile(stale.signature, sign(null, changed, keys.privateKey).toString("base64") + "\n");
    denied(stale, "PLUGIN_M1A_STALE_WORKER_RELEASE_ACCEPTED");
    await writeFile(stale.lock, lockBytes);
    await writeFile(stale.signature,
      sign(null, lockBytes, keys.privateKey).toString("base64") + "\n");
    const altered = fixtures[2]!;
    await writeFile(altered.module, 'export default { compromised: true };\n');
    denied(altered, "PLUGIN_M1A_TAMPERED_ARTIFACT_ACCEPTED");
    // No module import should ever run the deliberately throwing fixture.
    console.info("PLUGIN_M1A_SIGNED_FLEET_STAGE: stale Worker and changed ESM rejected");

    // An unsigned sibling must not downgrade strict admission.
    await rm(fixtures[0]!.signature);
    denied(fixtures[0]!, "PLUGIN_M1A_UNSIGNED_FALLBACK_ACCEPTED");
    console.info("PLUGIN_M1A_SIGNED_FLEET_PASSED: four verified receipts and fail-closed signer/release negatives");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
void run().catch(() => {
  // Only fixed diagnostics; never print untrusted file contents or key paths.
  console.error("PLUGIN_M1A_SIGNED_FLEET_FAILED");
  process.exitCode = 1;
});
