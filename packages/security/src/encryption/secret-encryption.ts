import crypto from "node:crypto";
import { getConfig } from "@vibress/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

export interface EncryptedPayload {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

export class SecretEncryptionError extends Error {
  constructor(
    message: string,
    public code = "ENCRYPTION_ERROR",
  ) {
    super(message);
    this.name = "SecretEncryptionError";
  }
}

/**
 * Derives a 32-byte key buffer from the VIBRESS_ENCRYPTION_KEY string or env var.
 */
export function getMasterKeyBuffer(customKey?: string): Buffer {
  const rawKey = customKey || getConfig().secrets.encryptionKey;
  if (!rawKey || !rawKey.trim()) {
    throw new SecretEncryptionError(
      "VIBRESS_ENCRYPTION_KEY is missing. Master encryption key is required for secret operations.",
      "STORAGE_ENCRYPTION_KEY_MISSING",
    );
  }

  const keyString = rawKey.trim();
  // If key is 64 hex chars, parse directly
  if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
    return Buffer.from(keyString, "hex");
  }

  // Otherwise derive a 32-byte key via SHA-256
  return crypto.createHash("sha256").update(keyString).digest();
}

/**
 * Encrypts a plaintext secret string using AES-256-GCM.
 */
export function encryptSecret(plaintext: string, masterKey?: string): string {
  if (typeof plaintext !== "string") {
    throw new SecretEncryptionError("Plaintext secret must be a string");
  }

  const keyBuffer = getMasterKeyBuffer(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts an encrypted payload JSON string using AES-256-GCM.
 */
export function decryptSecret(
  encryptedPayloadJson: string,
  masterKey?: string,
): string {
  if (!encryptedPayloadJson || typeof encryptedPayloadJson !== "string") {
    throw new SecretEncryptionError(
      "Encrypted payload must be a non-empty string",
    );
  }

  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(encryptedPayloadJson);
  } catch {
    throw new SecretEncryptionError(
      "Failed to parse encrypted secret payload",
      "STORAGE_ENCRYPTION_INVALID",
    );
  }

  if (payload.v !== 1 || !payload.iv || !payload.tag || !payload.data) {
    throw new SecretEncryptionError(
      "Invalid encrypted secret payload structure",
      "STORAGE_ENCRYPTION_INVALID",
    );
  }

  const keyBuffer = getMasterKeyBuffer(masterKey);
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const data = Buffer.from(payload.data, "hex");

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new SecretEncryptionError(
      "Failed to decrypt secret. Key may be invalid or payload tampered.",
      "STORAGE_DECRYPTION_FAILED",
    );
  }
}
