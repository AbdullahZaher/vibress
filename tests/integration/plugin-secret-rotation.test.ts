import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  getDbPool, runMigrations, seedDatabase, closeDbPool,
} from "@vibress/database";
import {
  decryptPluginSecret, encryptPluginSecret, encryptSecret,
} from "@vibress/security";
import { rotatePluginSecretRows } from "../../scripts/plugins/rotate-secret-rows";

/**
 * Real PostgreSQL integration: exercise the exact operator CLI migration
 * kernel against an isolated plugin fixture in the shared CI database.
 * This test never scans/mutates another installed plugin's settings.
 */
describe("PLUG-OPS-05 PostgreSQL secret rotation, restart and CAS", () => {
  const pluginId = randomUUID();
  const manifestId = "key-rotation-" + pluginId.slice(0, 12);
  const globalId = randomUUID();
  const scopedId = randomUUID();
  const oldKey = "a".repeat(64);
  const keyOne = "b".repeat(64);
  const keyTwo = "c".repeat(64);
  const originalGlobal = "legacy-global-credential";
  const originalScoped = "arabic-سري-scoped-credential";
  let publicationId: string;

  function ring(active: string, keys: Record<string, string>): void {
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ACTIVE_KEY_ID", active);
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_KEYS_JSON", JSON.stringify(keys));
  }
  async function stored() {
    const pool = getDbPool();
    const global = await pool.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM plugin_settings WHERE id = $1", [globalId],
    );
    const scoped = await pool.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM plugin_publication_settings WHERE id = $1", [scopedId],
    );
    return {
      global: global.rows[0]?.encrypted_value,
      scoped: scoped.rows[0]?.encrypted_value,
    };
  }

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", oldKey);
    vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE", "1");
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ROTATION_APPLY", "1");
    const pool = getDbPool();
    const selected = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
    const pub = selected.rows[0];
    if (!pub) throw new Error("No seeded publication for secret rotation fixture");
    publicationId = pub.id;
    await pool.query(
      `INSERT INTO plugins (id, manifest_id, name, version, vibress_api_version, entrypoint)
       VALUES ($1, $2, 'Rotation Fixture', '1.0.0', '1.0.0', 'dist/index.mjs')`,
      [pluginId, manifestId],
    );
    await pool.query(
      "INSERT INTO plugin_publication_states (plugin_id, publication_id, enabled) VALUES ($1, $2, true)",
      [pluginId, publicationId],
    );
    await pool.query(
      `INSERT INTO plugin_settings
         (id, plugin_id, key, is_secret, encrypted_value, value)
       VALUES ($1, $2, 'globalToken', true, $3, NULL)`,
      [globalId, pluginId, encryptSecret(originalGlobal, oldKey)],
    );
    await pool.query(
      `INSERT INTO plugin_publication_settings
         (id, plugin_id, publication_id, key, is_secret, encrypted_value, value)
       VALUES ($1, $2, $3, 'scopedToken', true, $4, NULL)`,
      [scopedId, pluginId, publicationId, encryptSecret(originalScoped, oldKey)],
    );
  }, 30000);

  afterAll(async () => {
    const pool = getDbPool();
    await pool.query("DELETE FROM plugin_publication_settings WHERE plugin_id = $1", [pluginId]);
    await pool.query("DELETE FROM plugin_settings WHERE plugin_id = $1", [pluginId]);
    await pool.query("DELETE FROM plugin_publication_states WHERE plugin_id = $1", [pluginId]);
    await pool.query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    vi.unstubAllEnvs();
    await closeDbPool();
  });

  it("rejects imported apply calls without explicit operator maintenance and approval", async () => {
    ring("one", { one: keyOne, two: keyTwo });
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ROTATION_APPLY", "0");
    await expect(rotatePluginSecretRows({ apply: true, maxRows: 10, pluginId }))
      .rejects.toThrow("PLUGIN_SECRET_ROTATION_APPROVAL_REQUIRED");
    vi.stubEnv("VIBRESS_PLUGIN_SECRET_ROTATION_APPLY", "1");
    vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "0");
    await expect(rotatePluginSecretRows({ apply: false, maxRows: 10, pluginId }))
      .rejects.toThrow("PLUGIN_SECRET_ROTATION_MAINTENANCE_REQUIRED");
    vi.stubEnv("VIBRESS_PLUGIN_RECOVERY_MAINTENANCE", "1");
  });

  it("dry-runs both persisted v1 tables without changing any stored bytes", async () => {
    ring("one", { one: keyOne, two: keyTwo });
    const before = await stored();
    await expect(rotatePluginSecretRows({
      apply: false, maxRows: 10, pluginId,
    })).resolves.toEqual({ scanned: 2, needed: 2, changed: 0 });
    expect(await stored()).toEqual(before);
  });

  it("stops safely after a partial apply and resumes without re-encrypting completed rows", async () => {
    ring("one", { one: keyOne, two: keyTwo });
    await expect(rotatePluginSecretRows({
      apply: true, maxRows: 1, pluginId,
    })).rejects.toThrow("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_EXCEEDED");
    const halfway = await stored();
    expect(JSON.parse(halfway.global ?? "{}")).toMatchObject({ v: 2, kid: "one" });
    expect(JSON.parse(halfway.scoped ?? "{}")).toMatchObject({ v: 1 });
    await expect(rotatePluginSecretRows({
      apply: true, maxRows: 10, pluginId,
    })).resolves.toEqual({ scanned: 2, needed: 1, changed: 1 });
    const completed = await stored();
    expect(JSON.parse(completed.scoped ?? "{}")).toMatchObject({ v: 2, kid: "one" });
    expect(decryptPluginSecret(completed.global ?? "", { pluginId, key: "globalToken" }))
      .toBe(originalGlobal);
    expect(decryptPluginSecret(completed.scoped ?? "", {
      pluginId, publicationId, key: "scopedToken",
    })).toBe(originalScoped);
    expect(() => decryptPluginSecret(completed.scoped ?? "", {
      pluginId, publicationId: "other-publication", key: "scopedToken",
    })).toThrow();
    await expect(rotatePluginSecretRows({
      apply: true, maxRows: 10, pluginId,
    })).resolves.toEqual({ scanned: 2, needed: 0, changed: 0 });
    expect(await stored()).toEqual(completed);
  });

  it("rotates the current key and validates that old keys cannot be dropped early", async () => {
    ring("two", { one: keyOne, two: keyTwo });
    await expect(rotatePluginSecretRows({
      apply: true, maxRows: 10, pluginId,
    })).resolves.toEqual({ scanned: 2, needed: 2, changed: 2 });
    const current = await stored();
    expect(JSON.parse(current.global ?? "{}")).toMatchObject({ v: 2, kid: "two" });
    expect(JSON.parse(current.scoped ?? "{}")).toMatchObject({ v: 2, kid: "two" });
    ring("two", { two: keyTwo });
    await expect(rotatePluginSecretRows({
      apply: false, maxRows: 10, pluginId,
    })).resolves.toEqual({ scanned: 2, needed: 0, changed: 0 });
    expect(decryptPluginSecret(current.scoped ?? "", {
      pluginId, publicationId, key: "scopedToken",
    })).toBe(originalScoped);
    ring("two", { one: keyOne });
    await expect(rotatePluginSecretRows({ apply: false, maxRows: 10, pluginId }))
      .rejects.toThrow("Invalid plugin secret keyring policy");
  });

  it("refuses stale CAS writes and preserves a concurrently replaced scoped credential", async () => {
    ring("two", { one: keyOne, two: keyTwo });
    const prior = await stored();
    const replacement = encryptPluginSecret("replaced-in-db", {
      pluginId, publicationId, key: "scopedToken",
    });
    const pool = getDbPool();
    await pool.query(
      "UPDATE plugin_publication_settings SET encrypted_value = $1 WHERE id = $2",
      [replacement, scopedId],
    );
    const stale = await pool.query(
      `UPDATE plugin_publication_settings SET encrypted_value = $1
       WHERE id = $2 AND plugin_id = $3 AND publication_id = $4
         AND key = 'scopedToken' AND is_secret = true AND encrypted_value = $5
       RETURNING id`,
      [prior.scoped, scopedId, pluginId, publicationId, prior.scoped],
    );
    expect(stale.rows).toHaveLength(0);
    const persisted = await stored();
    expect(decryptPluginSecret(persisted.scoped ?? "", {
      pluginId, publicationId, key: "scopedToken",
    })).toBe("replaced-in-db");
    // Dry-run does not overwrite the concurrent replacement.
    await expect(rotatePluginSecretRows({ apply: false, maxRows: 10, pluginId }))
      .resolves.toEqual({ scanned: 2, needed: 0, changed: 0 });
  });

  it("fails closed on corrupt ciphertext without modifying stored credentials", async () => {
    ring("two", { one: keyOne, two: keyTwo });
    const prior = await stored();
    const pool = getDbPool();
    await pool.query("UPDATE plugin_settings SET encrypted_value = $1 WHERE id = $2",
      ["not-a-ciphertext", globalId]);
    await expect(rotatePluginSecretRows({ apply: false, maxRows: 10, pluginId }))
      .rejects.toThrow();
    expect((await stored()).scoped).toBe(prior.scoped);
    await pool.query("UPDATE plugin_settings SET encrypted_value = $1 WHERE id = $2",
      [prior.global, globalId]);
    await expect(rotatePluginSecretRows({ apply: false, maxRows: 10, pluginId }))
      .resolves.toEqual({ scanned: 2, needed: 0, changed: 0 });
  });
  it("restores a complete secret keyring and legacy key without changing persisted records", async () => {
    // Model a recovered PostgreSQL snapshot whose values were already
    // rewrapped to key 'two'. Configuration restore must not modify those
    // ciphertexts or silently fall back to a stale key.
    const before = await stored();
    expect(JSON.parse(before.global ?? "{}")).toMatchObject({ v: 2, kid: "two" });
    expect(JSON.parse(before.scoped ?? "{}")).toMatchObject({ v: 2, kid: "two" });
    const globalScope = { pluginId, key: "globalToken" };
    const scopedScope = { pluginId, publicationId, key: "scopedToken" };

    // Restoring an earlier, otherwise valid keyring without the active
    // ciphertext key must deny both global and publication-local reads.
    ring("one", { one: keyOne });
    expect(() => decryptPluginSecret(before.global ?? "", globalScope))
      .toThrow("Unknown plugin secret encryption key");
    expect(() => decryptPluginSecret(before.scoped ?? "", scopedScope))
      .toThrow("Unknown plugin secret encryption key");
    expect(await stored()).toEqual(before);

    // The same backed-up ciphertext becomes readable after restoring the
    // complete authorized ring, with no migrations or SQL updates.
    ring("two", { one: keyOne, two: keyTwo });
    expect(decryptPluginSecret(before.global ?? "", globalScope))
      .toBe(originalGlobal);
    expect(decryptPluginSecret(before.scoped ?? "", scopedScope))
      .toBe("replaced-in-db");
    expect(() => decryptPluginSecret(before.scoped ?? "", {
      ...scopedScope, publicationId: randomUUID(),
    })).toThrow("Plugin secret decryption failed");

    // The legacy v1 master key is a *separate* recovery dependency. Losing
    // it must deny old rows even when the v2 ring is correct.
    const legacyCipher = encryptSecret("legacy-recovery-sentinel", oldKey);
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", "d".repeat(64));
    expect(() => decryptPluginSecret(legacyCipher, globalScope))
      .toThrow("Failed to decrypt secret");
    vi.stubEnv("VIBRESS_ENCRYPTION_KEY", oldKey);
    expect(decryptPluginSecret(legacyCipher, globalScope))
      .toBe("legacy-recovery-sentinel");
    expect(await stored()).toEqual(before);
  });

});
