import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, SecretEncryptionError } from "../encryption/secret-encryption";
import {
  assertPluginSecretRotationReady, decryptPluginSecret,
  encryptPluginSecret, rewrapPluginSecret,
} from "../encryption/plugin-secret-keyring";

const old = "a".repeat(64);
const first = "b".repeat(64);
const next = "c".repeat(64);
const scope = { pluginId: "plugin-a", publicationId: "publication-a", key: "apiToken" };
const legacy = { pluginId: "plugin-a", key: "apiToken" };

afterEach(() => { vi.unstubAllEnvs(); });

function configure(active: string, keys: Record<string, string>) {
  vi.stubEnv("VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID", active);
  vi.stubEnv("VIBRESS_PLUGIN_SECRET_KEYS_JSON", JSON.stringify(keys));
}

describe("PLUG-OPS-05 key-versioned plugin secrets", () => {
  it("keeps legacy global/scoped reads and v1 writes when opt-in is absent", () => {
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", old);
    const ciphertext = encryptPluginSecret("legacy secret", scope);
    expect(JSON.parse(ciphertext).v).toBe(1);
    expect(decryptPluginSecret(ciphertext, scope)).toBe("legacy secret");
    expect(decryptSecret(ciphertext, old)).toBe("legacy secret");
    const legacyGlobal = encryptSecret("global secret", old);
    expect(decryptPluginSecret(legacyGlobal, legacy)).toBe("global secret");
    expect(() => assertPluginSecretRotationReady()).toThrow("Plugin secret rotation key missing");
  });

  it("opt-in writes v2 with an authenticated scope and current key identifier", () => {
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", old);
    configure("first", { first, next });
    const ciphertext = encryptPluginSecret("مفتاح سري", scope);
    const payload = JSON.parse(ciphertext);
    expect(payload.v).toBe(2);
    expect(payload.kid).toBe("first");
    expect(ciphertext).not.toContain("مفتاح سري");
    expect(decryptPluginSecret(ciphertext, scope)).toBe("مفتاح سري");
    expect(() => decryptPluginSecret(ciphertext, { ...scope, publicationId: "publication-b" }))
      .toThrow("Plugin secret decryption failed");
    expect(() => decryptPluginSecret(ciphertext, { ...scope, pluginId: "plugin-b" }))
      .toThrow("Plugin secret decryption failed");
    expect(() => decryptPluginSecret(ciphertext, { ...scope, key: "otherToken" }))
      .toThrow("Plugin secret decryption failed");
    expect(() => decryptPluginSecret(ciphertext, legacy))
      .toThrow(SecretEncryptionError);
  });

  it("migrates v1 to the active key and rotates v2 without losing readability", () => {
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", old);
    const v1 = encryptSecret("recoverable", old);
    configure("first", { first, next });
    const migrated = rewrapPluginSecret(v1, scope);
    expect(migrated).not.toBeNull();
    if (!migrated) throw new Error("Missing first ciphertext");
    expect(JSON.parse(migrated).kid).toBe("first");
    expect(rewrapPluginSecret(migrated, scope)).toBeNull();
    configure("next", { first, next });
    const rotated = rewrapPluginSecret(migrated, scope);
    if (!rotated) throw new Error("Missing rotated ciphertext");
    expect(JSON.parse(rotated).kid).toBe("next");
    expect(decryptPluginSecret(rotated, scope)).toBe("recoverable");
    configure("next", { next });
    expect(decryptPluginSecret(rotated, scope)).toBe("recoverable");
    expect(() => decryptPluginSecret(migrated, scope)).toThrow("Unknown plugin secret encryption key");
    // Dropping the v1 key early also makes legacy records inaccessible.
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", "d".repeat(64));
    expect(() => decryptPluginSecret(v1, scope)).toThrow("Failed to decrypt secret");
  });

  it("refuses malformed/partial/missing active key config without returning plaintext", () => {
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", old);
    const v1 = encryptSecret("very-private", old);
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID", "first");
    expect(() => decryptPluginSecret(v1, scope)).toThrow("Invalid plugin secret keyring policy");
    for (const bad of [
      "{}", '{"first":"weak"}', '{"first":"weak","__proto__":"bad"}',
      '{"first":"b"}', "not-json", "", " ".repeat(8193),
    ]) {
      vi.stubEnv("VIBRESS_PLUGIN_SECRET_KEYS_JSON", bad);
      expect(() => encryptPluginSecret("very-private", scope))
        .toThrow("Invalid plugin secret keyring policy");
    }
    configure("missing", { first });
    expect(() => assertPluginSecretRotationReady()).toThrow("Invalid plugin secret keyring policy");
  });

  it("rejects tampering, unknown ciphertext versions and missing old keys", () => {
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", old);
    configure("first", { first });
    const encrypted = encryptPluginSecret("private", scope);
    const payload = JSON.parse(encrypted);
    expect(() => decryptPluginSecret(JSON.stringify({ ...payload, v: 3 }), scope))
      .toThrow("Invalid plugin secret payload");
    expect(() => decryptPluginSecret(JSON.stringify({ ...payload, kid: "unknown" }), scope))
      .toThrow("Unknown plugin secret encryption key");
    expect(() => decryptPluginSecret(JSON.stringify({
      ...payload, data: (payload.data[0] === "0" ? "1" : "0") + payload.data.slice(1),
    }), scope)).toThrow("Plugin secret decryption failed");
    expect(() => decryptPluginSecret(JSON.stringify({ ...payload, iv: "0" }), scope))
      .toThrow("Invalid plugin secret payload");
    configure("next", { next });
    expect(() => decryptPluginSecret(encrypted, scope))
      .toThrow("Unknown plugin secret encryption key");
  });
});
