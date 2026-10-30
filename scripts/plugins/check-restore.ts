import {
  getDb, closeDbPool, plugins, pluginPublicationStates,
  pluginEventReceipts, eq, and, inArray, sql, asc,
} from "@vibress/database";
import {
  verifyTrustedPluginRelease, verifyOperatorReleaseAdmission,
  assertPluginRestoreReadiness,
} from "@vibress/plugins";
import { selectPluginRestoreAdmission } from "./restore-admission-policy";

/**
 * EXT-403: run AFTER restoring a signed PostgreSQL snapshot and staging the
 * exact original operator-approved release, BEFORE unquiescing API/Worker.
 * Reads metadata only. No plugin code, secret decryption, DDL or jobs run.
 */
async function check(): Promise<void> {
  const admission = selectPluginRestoreAdmission(process.env);
  // Strict restore must enforce the SAME signed, reviewed, pinned admission
  // as strict API/Worker startup. Legacy preflight remains unchanged when
  // the operator has not opted into strict policy.
  const approved = admission.mode === "strict"
    ? (await verifyOperatorReleaseAdmission(
      admission.lockfile, admission.expectedLockfileSha256,
    )).releases
    : admission.mode === "legacy"
      ? await verifyTrustedPluginRelease(admission.lockfile)
      : [];
  const db = getDb();
  const enabled = await db.select({
    manifestId: plugins.manifestId,
    version: plugins.version,
  }).from(pluginPublicationStates)
    .innerJoin(plugins, eq(pluginPublicationStates.pluginId, plugins.id))
    .where(and(
      eq(pluginPublicationStates.enabled, true),
      eq(plugins.status, "active"),
    ))
    .groupBy(plugins.manifestId, plugins.version);
  let pendingCount = 0;
  let cursor = "";
  // Cursor pagination avoids materializing years of durable receipts and does
  // not depend on a huge offset that can stall PostgreSQL during recovery.
  for (;;) {
    const rows = await db.select({
      id: pluginEventReceipts.id,
      envelope: pluginEventReceipts.envelope,
      envelopeHash: pluginEventReceipts.envelopeHash,
    }).from(pluginEventReceipts).where(and(
      inArray(pluginEventReceipts.status, ["pending", "dispatching", "queued"]),
      sql`${pluginEventReceipts.id} > ${cursor}`,
    )).orderBy(asc(pluginEventReceipts.id)).limit(250);
    if (!rows.length) break;
    assertPluginRestoreReadiness(enabled, rows, approved);
    pendingCount += rows.length;
    const last = rows.at(-1);
    if (!last) break;
    cursor = last.id;
  }
  // The enabled-only check also runs when no events are pending.
  assertPluginRestoreReadiness(enabled, [], approved);
  console.info(
    `Plugin restore preflight verified ${approved.length} releases, ` +
    `${enabled.length} distinct enabled installations, ${pendingCount} pending events`,
  );
}
void check().catch(() => {
  // Never reveal filesystem paths, ciphertext, decrypted secrets, or payload.
  console.error("Plugin restore preflight failed; keep normal replicas stopped");
  process.exitCode = 1;
}).finally(async () => {
  await closeDbPool();
});
