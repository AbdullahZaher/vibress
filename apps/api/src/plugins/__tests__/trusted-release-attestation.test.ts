import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readTrustedPluginLockfile } from "../trusted-release-attestation";

const dirs: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibress-attestation-"));
  dirs.push(dir);
  const lockfile = path.join(dir, "approved.json");
  const keyFile = path.join(dir, "operator.pub");
  const signatureFile = path.join(dir, "operator.sig");
  const payload = JSON.stringify({ schemaVersion: 1, plugins: [] });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  await Promise.all([
    writeFile(lockfile, payload),
    writeFile(keyFile, publicKey.export({ format: "pem", type: "spki" })),
    writeFile(signatureFile, sign(null, Buffer.from(payload), privateKey).toString("base64") + "\n"),
  ]);
  return {
    lockfile, keyFile, signatureFile, payload, privateKey,
    options: { publicKeyPath: keyFile, signaturePath: signatureFile },
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("EXT-404 detached operator Ed25519 lockfile attestation", () => {
  it("preserves unsigned trusted-lockfile v1 compatibility when not configured", async () => {
    const f = await fixture();
    await expect(readTrustedPluginLockfile(f.lockfile, {})).resolves.toEqual({
      schemaVersion: 1, plugins: [],
    });
  });

  it("authenticates the exact operator-approved lockfile bytes", async () => {
    const f = await fixture();
    await expect(readTrustedPluginLockfile(f.lockfile, f.options)).resolves.toEqual({
      schemaVersion: 1, plugins: [],
    });
  });

  it("fails closed when either operator attestation path is omitted", async () => {
    const f = await fixture();
    await expect(readTrustedPluginLockfile(f.lockfile, { publicKeyPath: f.keyFile }))
      .rejects.toThrow(/Incomplete/);
    await expect(readTrustedPluginLockfile(f.lockfile, { signaturePath: f.signatureFile }))
      .rejects.toThrow(/Incomplete/);
  });

  it("rejects lockfile changes even when the resulting JSON remains valid", async () => {
    const f = await fixture();
    await writeFile(f.lockfile, f.payload + "\n");
    await expect(readTrustedPluginLockfile(f.lockfile, f.options))
      .rejects.toThrow(/signature verification failed/);
  });

  it("rejects substituted Ed25519 keys and corrupt signatures", async () => {
    const f = await fixture();
    const { publicKey } = generateKeyPairSync("ed25519");
    await writeFile(f.keyFile, publicKey.export({ format: "pem", type: "spki" }));
    await expect(readTrustedPluginLockfile(f.lockfile, f.options))
      .rejects.toThrow(/signature verification failed/);
    await writeFile(f.signatureFile, "not-a-valid-signature");
    await expect(readTrustedPluginLockfile(f.lockfile, f.options))
      .rejects.toThrow(/Invalid trusted plugin lockfile signature/);
  });

  it("rejects symlinks and relative trust-root paths", async () => {
    const f = await fixture();
    const linked = path.join(path.dirname(f.keyFile), "linked.pub");
    await symlink(f.keyFile, linked);
    await expect(readTrustedPluginLockfile(f.lockfile, {
      publicKeyPath: linked, signaturePath: f.signatureFile,
    })).rejects.toThrow(/attestation file/);
    await expect(readTrustedPluginLockfile("relative-lockfile.json", {}))
      .rejects.toThrow(/lockfile path/);
    await expect(readTrustedPluginLockfile(f.lockfile, {
      publicKeyPath: f.keyFile, signaturePath: "relative.sig",
    })).rejects.toThrow(/attestation path/);
  });

  it("rejects malformed text and oversized input before parsing or admission", async () => {
    const f = await fixture();
    await writeFile(f.lockfile, Buffer.from([0xc3, 0x28]));
    await expect(readTrustedPluginLockfile(f.lockfile, {})).rejects.toThrow();
    await writeFile(f.lockfile, "\0");
    await expect(readTrustedPluginLockfile(f.lockfile, {})).rejects.toThrow(/text/);
    await writeFile(f.lockfile, " ".repeat(129 * 1024));
    await expect(readTrustedPluginLockfile(f.lockfile, {})).rejects.toThrow(/lockfile/);
  });
});
