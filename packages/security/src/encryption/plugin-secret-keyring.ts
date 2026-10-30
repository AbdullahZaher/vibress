import crypto from "node:crypto";
import { decryptSecret, encryptSecret, SecretEncryptionError } from "./secret-encryption";

/**
 * Additive, opt-in key-versioned storage for plugin-owned secrets only.
 * Version 1 ciphertext remains readable with VIBRESS_ENCRYPTION_KEY.
 * Version 2 authenticates the immutable plugin/publication/setting scope.
 * This is a host-only API; plugin code never gets an encryption key.
 */
export interface PluginSecretScope {
  readonly pluginId: string;
  readonly publicationId?: string;
  readonly key: string;
}

const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;
const HEX_KEY = /^[a-fA-F0-9]{64}$/;
const HEX_IV = /^[a-f0-9]{24}$/;
const HEX_TAG = /^[a-f0-9]{32}$/;
const HEX_DATA = /^(?:[a-f0-9]{2})*$/;
const MAX_KEYRING_BYTES = 8192;
const MAX_PAYLOAD_BYTES = 65536;

interface Keyring {
  readonly activeId: string | null;
  readonly keys: ReadonlyMap<string, Buffer>;
}

function invalidKeyring(): never {
  throw new SecretEncryptionError("Invalid plugin secret keyring policy", "PLUGIN_SECRET_KEYRING_INVALID");
}

/** Every runtime must receive the same authorized complete keyring. */
function keyring(): Keyring {
  const json = process.env.VIBRESS_PLUGIN_SECRET_KEYS_JSON;
  const activeId = process.env.VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID;
  if (json === undefined && activeId === undefined) {
    return { activeId: null, keys: new Map() };
  }
  if (!json || !activeId || !KEY_ID.test(activeId) ||
      Buffer.byteLength(json, "utf8") > MAX_KEYRING_BYTES) return invalidKeyring();
  let record: unknown;
  try {
    record = JSON.parse(json);
  } catch {
    return invalidKeyring();
  }
  if (record === null || typeof record !== "object" || Array.isArray(record) ||
      Object.getPrototypeOf(record) !== Object.prototype) return invalidKeyring();
  const entries = Object.entries(record);
  if (entries.length < 1 || entries.length > 16) return invalidKeyring();
  const keys = new Map<string, Buffer>();
  for (const [id, raw] of entries) {
    if (!KEY_ID.test(id) || typeof raw !== "string" || !HEX_KEY.test(raw)) {
      return invalidKeyring();
    }
    keys.set(id, Buffer.from(raw, "hex"));
  }
  if (!keys.has(activeId)) return invalidKeyring();
  return { activeId, keys };
}

function assertScope(scope: PluginSecretScope): void {
  if (!scope || typeof scope.pluginId !== "string" || scope.pluginId.length < 1 ||
      scope.pluginId.length > 256 || typeof scope.key !== "string" ||
      scope.key.length < 1 || scope.key.length > 100 ||
      (scope.publicationId !== undefined &&
        (typeof scope.publicationId !== "string" || scope.publicationId.length < 1 ||
         scope.publicationId.length > 256))) {
    throw new SecretEncryptionError("Invalid plugin secret scope", "PLUGIN_SECRET_SCOPE_INVALID");
  }
}
function aad(scope: PluginSecretScope, keyId: string): Buffer {
  assertScope(scope);
  return Buffer.from(JSON.stringify([
    "vibress", "plugin-secret", 2, keyId,
    scope.pluginId, scope.publicationId ?? null, scope.key,
  ]));
}

function parseCiphertext(ciphertext: string): Record<string, unknown> {
  if (typeof ciphertext !== "string" || ciphertext.length > MAX_PAYLOAD_BYTES) {
    throw new SecretEncryptionError("Invalid plugin secret payload", "PLUGIN_SECRET_INVALID");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(ciphertext); } catch {
    throw new SecretEncryptionError("Invalid plugin secret payload", "PLUGIN_SECRET_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SecretEncryptionError("Invalid plugin secret payload", "PLUGIN_SECRET_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function activeKey(ring: Keyring): { id: string; key: Buffer } {
  const id = ring.activeId;
  const key = id ? ring.keys.get(id) : undefined;
  if (!id || !key) {
    throw new SecretEncryptionError("Plugin secret rotation key missing", "PLUGIN_SECRET_KEYRING_REQUIRED");
  }
  return { id, key };
}

function encryptV2(plaintext: string, scope: PluginSecretScope, ring: Keyring): string {
  const current = activeKey(ring);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(aad(scope, current.id));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 2, kid: current.id, iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"), data: ciphertext.toString("hex"),
  });
}

/** Without an opted-in keyring, preserve exact legacy v1 writes. */
export function encryptPluginSecret(plaintext: string, scope: PluginSecretScope): string {
  assertScope(scope);
  if (typeof plaintext !== "string") {
    throw new SecretEncryptionError("Plaintext secret must be a string");
  }
  const ring = keyring();
  return ring.activeId ? encryptV2(plaintext, scope, ring) : encryptSecret(plaintext);
}

/** A missing/removed v2 key fails closed; never try random fallback keys. */
export function decryptPluginSecret(ciphertext: string, scope: PluginSecretScope): string {
  assertScope(scope);
  const ring = keyring();
  const payload = parseCiphertext(ciphertext);
  if (payload.v === 1) return decryptSecret(ciphertext);
  if (payload.v !== 2 || typeof payload.kid !== "string" ||
      !KEY_ID.test(payload.kid) || typeof payload.iv !== "string" ||
      !HEX_IV.test(payload.iv) || typeof payload.tag !== "string" ||
      !HEX_TAG.test(payload.tag) || typeof payload.data !== "string" ||
      payload.data.length > MAX_PAYLOAD_BYTES || !HEX_DATA.test(payload.data)) {
    throw new SecretEncryptionError("Invalid plugin secret payload", "PLUGIN_SECRET_INVALID");
  }
  const key = ring.keys.get(payload.kid);
  if (!key) {
    throw new SecretEncryptionError("Unknown plugin secret encryption key", "PLUGIN_SECRET_KEY_UNKNOWN");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm", key, Buffer.from(payload.iv, "hex"),
    );
    // Authenticate the key selector as well as the plugin/publication/key scope.
    // Using the same raw key under another ID cannot alter key provenance.
    decipher.setAAD(aad(scope, payload.kid));
    decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, "hex")), decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretEncryptionError("Plugin secret decryption failed", "PLUGIN_SECRET_DECRYPTION_FAILED");
  }
}

/**
 * Offline migration helper. Returns null if already encrypted with current key,
 * but still verifies authentication and scope. No ciphertext or plaintext is
 * emitted to logs, and a concurrent DB writer must be protected with CAS.
 */
export function rewrapPluginSecret(ciphertext: string, scope: PluginSecretScope): string | null {
  const ring = keyring();
  const current = activeKey(ring);
  const payload = parseCiphertext(ciphertext);
  const plaintext = decryptPluginSecret(ciphertext, scope);
  if (payload.v === 2 && payload.kid === current.id) return null;
  const rotated = encryptV2(plaintext, scope, ring);
  if (decryptPluginSecret(rotated, scope) !== plaintext) {
    throw new SecretEncryptionError("Plugin secret rewrap verification failed");
  }
  return rotated;
}

/** Operators can check readiness without printing or returning any key bytes. */
export function assertPluginSecretRotationReady(): void {
  activeKey(keyring());
}
