import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyOperatorReleaseAdmission, verifyTrustedPluginRelease } from "../operator-release-preflight";
import { pluginPhysicalModelDigest } from "@vibress/plugins";

const directories: string[] = [];
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibress-plugin-admit-"));
  directories.push(dir);
  await mkdir(path.join(dir, "dist"));
  const source = 'throw new Error("Untrusted bundle evaluated during admission");\n';
  const moduleFile = path.join(dir, "dist", "plugin.mjs");
  await writeFile(moduleFile, source);
  const sbomPath = path.join(dir, "sbom.json");
  const provenancePath = path.join(dir, "provenance.json");
  await writeFile(sbomPath, '{"packages":[]}');
  await writeFile(provenancePath, '{"buildType":"operator-reviewed"}');
  const reviewPath = path.join(dir, "security-review.json");
  const reviewedArtifact = sha256(source);
  const review = JSON.stringify({
    schemaVersion: 1,
    artifactSha256: reviewedArtifact,
    reviewer: "Platform Security",
    scanner: "Operator offline scan",
    scannedAt: "2026-10-24T12:00:00Z",
    criticalFindings: 0,
    highFindings: 0,
    decision: "approved",
  });
  await writeFile(reviewPath, review);
  const manifest = {
    id: "hello-public", name: "Hello Public", version: "1.0.0",
    vibressApiVersion: "1.0.0", entrypoint: "dist/plugin.mjs",
    capabilities: ["events.subscribe"],
  };
  const entry = {
    manifest, sha256: sha256(source),
    release: {
      schemaVersion: 1,
      releaseId: `${manifest.id}@${manifest.version}:${sha256(source)}`,
      publisher: { id: "reviewed", name: "Reviewed Publisher" },
      compatibility: {
        minVibressApiVersion: "1.0.0", maxVibressApiVersion: "1.0.0",
        sdkAbiVersion: "1.0.0",
      },
      capabilities: manifest.capabilities,
      sbom: { path: "sbom.json", sha256: sha256('{"packages":[]}') },
      provenance: { path: "provenance.json", sha256: sha256('{"buildType":"operator-reviewed"}') },
      securityReview: { path: "security-review.json", sha256: sha256(review) },
    },
  };
  const lockfile = path.join(dir, "trusted-plugins.json");
  const publicKeyFile = path.join(dir, "operator-public.pem");
  const signatureFile = path.join(dir, "operator.sig");
  const keys = generateKeyPairSync("ed25519");
  async function approve(payload: object) {
    const bytes = Buffer.from(JSON.stringify(payload));
    await writeFile(lockfile, bytes);
    await writeFile(publicKeyFile, keys.publicKey.export({ format: "pem", type: "spki" }));
    await writeFile(signatureFile, sign(null, bytes, keys.privateKey).toString("base64") + "\n");
    return sha256(bytes);
  }
  const keyFingerprint = sha256(keys.publicKey.export({ format: "der", type: "spki" }));
  function configureSignature() {
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE", publicKeyFile);
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE", signatureFile);
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256", keyFingerprint);
  }
  const payload = { schemaVersion: 1, plugins: [entry] };
  const lockfileSha256 = await approve(payload);
  return { dir, moduleFile, sbomPath, reviewPath, entry, payload, lockfile, signatureFile,
    lockfileSha256, keyFingerprint, approve, configureSignature };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("P0-3 offline operator release admission", () => {
  it("reports the same verified signed release on each replica without executing it", async () => {
    const f = await fixture();
    f.configureSignature();
    const receipt = await verifyOperatorReleaseAdmission(f.lockfile);
    expect(receipt).toEqual({
      schemaVersion: 1, lockfileSha256: f.lockfileSha256, signatureVerified: true,
      publicKeySha256: f.keyFingerprint,
      releases: [{ pluginId: "hello-public", version: "1.0.0",
        sha256: f.entry.sha256, adminViewCount: 0 }],
    });
    await expect(verifyOperatorReleaseAdmission(f.lockfile, receipt.lockfileSha256))
      .resolves.toEqual(receipt);
    expect(await readFile(f.moduleFile, "utf8")).toContain("Untrusted bundle evaluated");
  });

  it("retains old unsigned runtime compatibility but rejects unsigned new admissions", async () => {
    const f = await fixture();
    await expect(verifyTrustedPluginRelease(f.lockfile)).resolves.toHaveLength(1);
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("OPERATOR_SIGNATURE_REQUIRED");
  });

  it("rejects missing release evidence and forged operator signatures", async () => {
    const f = await fixture();
    f.configureSignature();
    await f.approve({ schemaVersion: 1,
      plugins: [{ manifest: f.entry.manifest, sha256: f.entry.sha256 }] });
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("OPERATOR_RELEASE_EVIDENCE_REQUIRED");
    await f.approve(f.payload);
    await writeFile(f.signatureFile, "not-a-signature");
    await expect(verifyOperatorReleaseAdmission(f.lockfile)).rejects.toThrow();
  });

  it("refuses unreviewed security evidence, high findings and invalid operator roots", async () => {
    const f = await fixture();
    f.configureSignature();
    const report = JSON.parse(await readFile(f.reviewPath, "utf8"));
    report.highFindings = 1;
    const forged = JSON.stringify(report);
    await writeFile(f.reviewPath, forged);
    await f.approve({ ...f.payload, plugins: [{
      ...f.entry, release: { ...f.entry.release, securityReview: {
        path: "security-review.json", sha256: sha256(forged),
      } },
    }] });
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("OPERATOR_SECURITY_REVIEW_REJECTED");
    vi.stubEnv("VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256", "a".repeat(64));
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("OPERATOR_TRUST_ROOT_MISMATCH");
  });

  it("refuses mismatched replicas and modified artifacts", async () => {
    const f = await fixture();
    f.configureSignature();
    await expect(verifyOperatorReleaseAdmission(f.lockfile, "0".repeat(64)))
      .rejects.toThrow("OPERATOR_RELEASE_REPLICA_MISMATCH");
    await expect(verifyOperatorReleaseAdmission(f.lockfile, "../bad"))
      .rejects.toThrow("INVALID_EXPECTED_RELEASE_DIGEST");
    await writeFile(f.sbomPath, '{"packages":[{"name":"tampered"}]}');
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    await writeFile(f.sbomPath, '{"packages":[]}');
    await writeFile(f.moduleFile, "globalThis.__unapprovedExecution = true;");
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("APPROVED_ARTIFACT_MISMATCH");
    expect((globalThis as { __unapprovedExecution?: boolean }).__unapprovedExecution)
      .toBeUndefined();
  });

  it("requires an explicit review plan for every approved physical schema", async () => {
    const f = await fixture();
    f.configureSignature();
    const columns = [{ name: "title", type: "text" as const, required: true }];
    const model = { key: "article", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
    const manifest = { ...f.entry.manifest, capabilities: ["extension.storage.read"] };
    const entry = { ...f.entry, manifest, storageModels: [model],
      release: { ...f.entry.release, capabilities: manifest.capabilities } };
    await f.approve({ schemaVersion: 1, plugins: [entry] });
    await expect(verifyOperatorReleaseAdmission(f.lockfile))
      .rejects.toThrow("OPERATOR_RELEASE_MIGRATION_REVIEW_REQUIRED");
  });
});
