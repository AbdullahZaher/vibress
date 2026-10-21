import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
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

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  if (!path.isAbsolute(filePath)) throw new Error("Invalid trusted plugin lockfile attestation path");
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    throw new Error("Invalid trusted plugin lockfile or attestation file");
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength > maxBytes) throw new Error("Invalid trusted plugin lockfile size");
  return bytes;
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
export async function readTrustedPluginLockfile(
  lockfilePath: string,
  options: TrustedPluginAttestationOptions = {
    publicKeyPath: process.env.VIBRESS_TRUSTED_PLUGIN_PUBLIC_KEY_FILE,
    signaturePath: process.env.VIBRESS_TRUSTED_PLUGIN_SIGNATURE_FILE,
  },
): Promise<unknown> {
  if (!path.isAbsolute(lockfilePath)) throw new Error("Invalid trusted plugin lockfile path");
  const lockfileBytes = await readBoundedFile(lockfilePath, MAX_LOCKFILE_BYTES);
  const { publicKeyPath, signaturePath } = options;
  // Strict deployments must never silently fall back to unsigned v1 approval.
  // The explicit flag is additive: old operator-controlled unsigned installs
  // retain compatibility until their operator opts into enforcement.
  const requireSignature = process.env.VIBRESS_TRUSTED_PLUGIN_REQUIRE_SIGNATURE === "1";
  if (requireSignature && (!publicKeyPath || !signaturePath)) {
    throw new Error("Trusted plugin signature is required by operator policy");
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
    const encoded = decodeUtf8(signatureBytes).trim();
    if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) {
      throw new Error("Invalid trusted plugin lockfile signature");
    }
    const signature = Buffer.from(encoded, "base64");
    if (signature.length !== 64 || !verify(null, lockfileBytes, publicKey, signature)) {
      throw new Error("Trusted plugin lockfile signature verification failed");
    }
  }
  const parsed: unknown = JSON.parse(decodeUtf8(lockfileBytes));
  return parsed;
}
