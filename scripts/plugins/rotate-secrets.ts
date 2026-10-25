import {
  getDb, closeDbPool, pluginSettings, pluginPublicationSettings,
  and, asc, eq, sql,
} from "@vibress/database";
import {
  assertPluginSecretRotationReady, rewrapPluginSecret,
} from "@vibress/security";

/**
 * PLUG-OPS-05 operator-only, resumable PostgreSQL ciphertext migration.
 * Default is read-only dry-run; --apply requires explicit maintenance state.
 * NEVER print secret values, ciphertext, tenant IDs, setting keys or errors.
 * A conditional compare-and-swap protects concurrent change/revocation.
 *
 * Must run with normal API + Worker replicas quiesced and a verified backup.
 * This tool does not modify the system's primary VIBRESS_ENCRYPTION_KEY.
 */
async function main(): Promise<void> {
  if (process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE !== "1" ||
      process.env.VIBRESS_PLUGIN_SECRET_ROTATION_MAINTENANCE !== "1") {
    throw new Error("PLUGIN_SECRET_ROTATION_MAINTENANCE_REQUIRED");
  }
  assertPluginSecretRotationReady();

  const apply = process.argv.slice(2);
  if (apply.length > 1 || (apply.length === 1 && apply[0] !== "--apply")) {
    throw new Error("PLUGIN_SECRET_ROTATION_ARGUMENT_INVALID");
  }
  const write = apply.length === 1;
  if (write && process.env.VIBRESS_PLUGIN_SECRET_ROTATION_APPLY !== "1") {
    throw new Error("PLUGIN_SECRET_ROTATION_APPROVAL_REQUIRED");
  }

  const rawLimit = process.env.VIBRESS_PLUGIN_SECRET_ROTATION_SCAN_LIMIT ?? "100000";
  if (!/^[1-9][0-9]{0,5}$/.test(rawLimit) || Number(rawLimit) > 100000) {
    throw new Error("PLUGIN_SECRET_ROTATION_SCAN_LIMIT_INVALID");
  }
  const maxRows = Number(rawLimit);
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

  // No tenant IDs, keys or contents in stdout. Retain logs in operator custody.
  console.info("Plugin secret key-version migration", {
    mode: write ? "apply" : "dry-run", scanned, needed, changed,
  });
}

void main().catch(() => {
  console.error("Plugin secret rotation verification failed; retain previous keys and maintenance mode");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
