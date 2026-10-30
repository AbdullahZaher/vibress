import { createHash, createPublicKey, verify } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Operator-controlled, detached Ed25519 attestation of the exact lockfile
 * bytes. The signed lockfile itself pins the compiled ESM and Admin UI bytes.
 * This is provenance verification, not a JavaScript sandbox.
 */
export interface TrustedPluginAttestationOptions {
  readonly publicKeyPath?: string | undefined;
  readonly signaturePath?: string | undefined;
}

const MAX_LOCKFILE_BYTES = 128 * 1024;
const MAX_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_SIGNATURE_BYTES = 256;
const MAX_REVOKED_SIGNERS = 32;
const SHA256_FINGERPRINT = /^[a-f0-9]{64}$/;

/**
 * Optional operator-owned denylist. A revoked signer MUST be rejected even
 * when its signature and the old deployment pin still verify. Never obtain
 * this policy from plugin metadata or signed release content.
 *
 * An explicit but malformed policy fails closed; the absence of this env var
 * retains existing v1 self-hosted installations unchanged.
 */
function assertSignerNotRevoked(signerSha256: string | undefined): void {
  const policy = process.env.VIBRESS_TRUSTED_PLUGIN_REVOKED_PUBLIC_KEYS_SHA256;
  if (policy === undefined) return;
  const fingerprints = policy.split(",").map((value) => value.trim());
  if (fingerprints.length < 1 || fingerprints.length > MAX_REVOKED_SIGNERS ||
      fingerprints.some((value) => !SHA256_FINGERPRINT.test(value)) ||
      new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("INVALID_OPERATOR_SIGNER_REVOCATION_POLICY");
  }
  if (!signerSha256) {
    // Do not allow an unsigned lockfile to circumvent an opted-in denylist.
    throw new Error("OPERATOR_SIGNATURE_REQUIRED");
  }
  if (fingerprints.includes(signerSha256)) {
    throw new Error("OPERATOR_SIGNER_REVOKED");
  }
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  if (!path.isAbsolute(filePath)) throw new Error("Invalid trusted plugin lockfile attestation path");
  // Inspect and read one inode, not separately resolved path snapshots.
  let file;
  try {
    file = await open(filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error: unknown) {
    // Expected OS-level rejection of a symlink. Do not leak operator trust
    // paths through raw ELOOP diagnostics; fail closed without following it.
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error("Invalid trusted plugin lockfile or attestation file", { cause: error });
    }
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) {
      throw new Error("Invalid trusted plugin lockfile or attestation file");
    }
    const bytes = await file.readFile();
    if (bytes.byteLength > maxBytes) throw new Error("Invalid trusted plugin lockfile size");
    return bytes;
  } finally {
    await file.close();
  }
}

function decodeUtf8(bytes: Buffer): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\u0000")) throw new Error("Invalid trusted plugin lockfile text");
  return text;
}

/**
 * Reads and authenticates one immutable snapshot before parsing JSON.
 * Neither public key nor signature is accepted from a plugin, an HTTP
 * request, or the lockfile being authenticated.
 *
 * Both attestation environment variables are optional for existing trusted
 * deployments, but supplying only one fails closed. To require signatures,
 * operators must provision both files on every API replica.
 */
export async function readTrustedPluginLockfileWithVerification(
  lockfilePath: string,
  options: TrustedPluginAttestationOptions = {
    publicKeyPath: process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE,
    signaturePath: process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE,
  },
): Promise<{
  readonly lockfile: unknown;
  readonly signatureVerified: boolean;
  readonly publicKeySha256?: string;
}> {
  if (!path.isAbsolute(lockfilePath)) throw new Error("Invalid trusted plugin lockfile path");
  const lockfileBytes = await readBoundedFile(lockfilePath, MAX_LOCKFILE_BYTES);
  // A signed but revoked older lockfile is not enough: deployments pin the
  // exact expected digest outside all plugin-controlled files.
  const expectedRelease = process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_LOCKFILE_SHA256;
  if (expectedRelease !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(expectedRelease) ||
        createHash("sha256").update(lockfileBytes).digest("hex") !== expectedRelease) {
      throw new Error("OPERATOR_RELEASE_REPLICA_MISMATCH");
    }
  }
  const { publicKeyPath, signaturePath } = options;
  // Strict deployments must never silently fall back to unsigned v1 approval.
  // The explicit flag is additive: old operator-controlled unsigned installs
  // retain compatibility until their operator opts into enforcement.
  const requireSignature = process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1";
  if (requireSignature && (!publicKeyPath || !signaturePath)) {
    throw new Error("Trusted plugin signature is required by operator policy");
  }
  let publicKeySha256: string | undefined;
  const expectedKey = process.env.VIBRESS_TRUSTED_PLUGIN_EXPECTED_PUBLIC_KEY_SHA256;
  if (expectedKey !== undefined && !/^[a-f0-9]{64}$/.test(expectedKey)) {
    throw new Error("Invalid operator public key fingerprint policy");
  }
  if (expectedKey !== undefined && (!publicKeyPath || !signaturePath)) {
    throw new Error("Expected operator public key requires signed lockfile");
  }
  if (publicKeyPath !== undefined || signaturePath !== undefined) {
    if (!publicKeyPath || !signaturePath) {
      throw new Error("Incomplete trusted plugin lockfile attestation configuration");
    }
    const [keyBytes, signatureBytes] = await Promise.all([
      readBoundedFile(publicKeyPath, MAX_PUBLIC_KEY_BYTES),
      readBoundedFile(signaturePath, MAX_SIGNATURE_BYTES),
    ]);
    const pem = decodeUtf8(keyBytes);
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n/.test(pem)) {
      throw new Error("Invalid trusted plugin lockfile public key");
    }
    const publicKey = createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("Trusted plugin lockfile requires Ed25519");
    }
    publicKeySha256 = createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
    if (expectedKey !== undefined && publicKeySha256 !== expectedKey) {
      throw new Error("OPERATOR_TRUST_ROOT_MISMATCH");
    }
    const encoded = decodeUtf8(signatureBytes).trim();
    if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) {
      throw new Error("Invalid trusted plugin lockfile signature");
    }
    const signature = Buffer.from(encoded, "base64");
    if (signature.length !== 64 || !verify(null, lockfileBytes, publicKey, signature)) {
      throw new Error("Trusted plugin lockfile signature verification failed");
    }
  }
  // Check independently of the expected SPKI pin. Rotating deployment pins
  // must not silently reauthorize a known-compromised operator signer.
  assertSignerNotRevoked(publicKeySha256);
  const parsed: unknown = JSON.parse(decodeUtf8(lockfileBytes));
  return {
    lockfile: parsed,
    signatureVerified: Boolean(publicKeyPath && signaturePath),
    ...(publicKeySha256 ? { publicKeySha256 } : {}),
  };
}

/** Preserve the v1 reader contract and all existing verification policies. */
export async function readTrustedPluginLockfile(
  lockfilePath: string,
  options: TrustedPluginAttestationOptions = {
    publicKeyPath: process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE,
    signaturePath: process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE,
  },
): Promise<unknown> {
  return (await readTrustedPluginLockfileWithVerification(lockfilePath, options)).lockfile;
}
