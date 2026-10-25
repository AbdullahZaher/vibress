import {
  getDb, pluginSettings, pluginPublicationSettings, and, asc, eq, sql,
} from "@vibress/database";
import { assertPluginSecretRotationReady, rewrapPluginSecret } from "@vibress/security";

/**
 * Reusable operator-only migration kernel, exercised against real PostgreSQL.
 * The CLI always migrates the complete corpus. `pluginId` is an internal
 * test fixture selector, NEVER parsed from command-line input.
 *
 * No secret values or identifying fields are returned. CAS on exact owner,
 * secret flag and ciphertext prevents overwriting a concurrent write/revoke.
 */
export async function rotatePluginSecretRows(options: {
  readonly apply: boolean;
  readonly maxRows: number;
  readonly pluginId?: string;
}): Promise<{ scanned: number; needed: number; changed: number }> {
  const { apply: write, maxRows, pluginId } = options;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) {
    throw new Error("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_INVALID");
  }
  if (pluginId !== undefined && (typeof pluginId !== "string" || pluginId.length < 1 ||
    pluginId.length > 256)) {
    throw new Error("PLUGIN_SECRET_ROTATION_SCOPE_INVALID");
  }
  assertPluginSecretRotationReady();
  const db = getDb();
  let scanned = 0;
  let needed = 0;
  let changed = 0;

  // The old global table is intentionally included for bundled plugins.
  let globalCursor = "";
  for (;;) {
    const rows = await db.select({
      id: pluginSettings.id, pluginId: pluginSettings.pluginId,
      key: pluginSettings.key, encryptedValue: pluginSettings.encryptedValue,
    }).from(pluginSettings).where(and(
      eq(pluginSettings.isSecret, true),
      pluginId ? eq(pluginSettings.pluginId, pluginId) : undefined,
      sql`${pluginSettings.id} > ${globalCursor}`,
    )).orderBy(asc(pluginSettings.id)).limit(Math.min(100, maxRows - scanned + 1));
    if (!rows.length) break;
    if (scanned + rows.length > maxRows) throw new Error("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_EXCEEDED");
    for (const row of rows) {
      if (!row.encryptedValue) throw new Error("PLUGIN_SECRET_ROTATION_INVALID_CIPHERTEXT");
      const rotated = rewrapPluginSecret(row.encryptedValue, {
        pluginId: row.pluginId, key: row.key,
      });
      scanned++;
      if (rotated === null) continue;
      needed++;
      if (write) {
        const updated = await db.update(pluginSettings)
          .set({ encryptedValue: rotated, updatedAt: new Date() })
          .where(and(
            eq(pluginSettings.id, row.id), eq(pluginSettings.pluginId, row.pluginId),
            eq(pluginSettings.key, row.key), eq(pluginSettings.isSecret, true),
            eq(pluginSettings.encryptedValue, row.encryptedValue),
          )).returning({ id: pluginSettings.id });
        if (updated.length !== 1) throw new Error("PLUGIN_SECRET_ROTATION_CONCURRENT_CHANGE");
        changed++;
      }
    }
    const last = rows.at(-1);
    if (!last) break;
    globalCursor = last.id;
  }

  // Cursor order and exact publication identity are maintained per row.
  let scopedCursor = "";
  for (;;) {
    const rows = await db.select({
      id: pluginPublicationSettings.id,
      pluginId: pluginPublicationSettings.pluginId,
      publicationId: pluginPublicationSettings.publicationId,
      key: pluginPublicationSettings.key,
      encryptedValue: pluginPublicationSettings.encryptedValue,
    }).from(pluginPublicationSettings).where(and(
      eq(pluginPublicationSettings.isSecret, true),
      pluginId ? eq(pluginPublicationSettings.pluginId, pluginId) : undefined,
      sql`${pluginPublicationSettings.id} > ${scopedCursor}`,
    )).orderBy(asc(pluginPublicationSettings.id))
      .limit(Math.min(100, maxRows - scanned + 1));
    if (!rows.length) break;
    if (scanned + rows.length > maxRows) throw new Error("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_EXCEEDED");
    for (const row of rows) {
      if (!row.encryptedValue) throw new Error("PLUGIN_SECRET_ROTATION_INVALID_CIPHERTEXT");
      const rotated = rewrapPluginSecret(row.encryptedValue, {
        pluginId: row.pluginId, publicationId: row.publicationId, key: row.key,
      });
      scanned++;
      if (rotated === null) continue;
      needed++;
      if (write) {
        const updated = await db.update(pluginPublicationSettings)
          .set({ encryptedValue: rotated, updatedAt: new Date() })
          .where(and(
            eq(pluginPublicationSettings.id, row.id),
            eq(pluginPublicationSettings.pluginId, row.pluginId),
            eq(pluginPublicationSettings.publicationId, row.publicationId),
            eq(pluginPublicationSettings.key, row.key),
            eq(pluginPublicationSettings.isSecret, true),
            eq(pluginPublicationSettings.encryptedValue, row.encryptedValue),
          )).returning({ id: pluginPublicationSettings.id });
        if (updated.length !== 1) throw new Error("PLUGIN_SECRET_ROTATION_CONCURRENT_CHANGE");
        changed++;
      }
    }
    const last = rows.at(-1);
    if (!last) break;
    scopedCursor = last.id;
  }

  return { scanned, needed, changed };
}
