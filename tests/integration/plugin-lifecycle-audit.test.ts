import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getDbPool, runMigrations, seedDatabase, closeDbPool } from "@vibress/database";
import {
  DrizzlePluginRepository, DrizzlePluginPublicationStateRepository,
  listPluginActivity,
} from "@vibress/plugins";

/** M1A/PLUG-OPS-06: state and durable audit commits must match. */
describe("Plugin lifecycle and publication audit transaction boundaries", () => {
  const pluginId = randomUUID();
  const actorUserId = "operator-fixture-" + randomUUID();
  const requestId = "req-" + randomUUID();
  const audit = { actorUserId, requestId };
  const pluginRepo = new DrizzlePluginRepository();
  const publicationRepo = new DrizzlePluginPublicationStateRepository();
  let publicationId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
    await seedDatabase();
    const pool = getDbPool();
    const result = await pool.query<{ id: string }>("SELECT id FROM publications LIMIT 1");
    const publication = result.rows[0];
    if (!publication) throw new Error("Missing integration publication");
    publicationId = publication.id;
  }, 30000);

  afterAll(async () => {
    const pool = getDbPool();
    await pool.query(
      "DELETE FROM audit_events WHERE actor_user_id = $1", [actorUserId],
    );
    await pool.query(
      "DELETE FROM plugin_publication_states WHERE plugin_id = $1", [pluginId],
    );
    if (createdIds.includes(pluginId)) {
      await pool.query("DELETE FROM plugins WHERE id = $1", [pluginId]);
    }
    await closeDbPool();
  });

  it("atomically records global register/update/activate/deactivate without assigning a publication", async () => {
    const created = await pluginRepo.create({
      id: pluginId, manifestId: "audit-" + pluginId.slice(0, 24),
      name: "Lifecycle Fixture", version: "1.0.0",
      vibressApiVersion: "1.0.0", entrypoint: "dist/main.mjs",
      capabilities: [], hooks: [], settingsSchema: {},
    }, audit);
    createdIds.push(created.id);
    await pluginRepo.updateMetadata(pluginId, { name: "Fixture v2" }, audit);
    await pluginRepo.updateStatus(pluginId, "active", undefined, audit);
    await pluginRepo.updateStatus(pluginId, "inactive", undefined, audit);
    const result = await getDbPool().query<{
      action: string; publication_id: string | null; metadata: unknown;
      actor_user_id: string; request_id: string;
    }>(
      `SELECT action, publication_id, metadata, actor_user_id, request_id
       FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at, id`,
      [actorUserId],
    );
    const global = result.rows;
    expect(global.map(row => row.action).sort()).toEqual([
      "plugin.activated", "plugin.deactivated",
      "plugin.registered", "plugin.updated",
    ]);
    for (const row of global) {
      expect(row.publication_id).toBeNull();
      expect(row.metadata).toBeNull();
      expect(row.actor_user_id).toBe(actorUserId);
      expect(row.request_id).toBe(requestId);
    }
    // Global operator actions must never impersonate a specific publication.
    expect((await listPluginActivity(publicationId, pluginId, 0, 25)).items)
      .toHaveLength(0);
  });

  it("persists only distinct site-enable decisions and scopes their audit rows", async () => {
    await publicationRepo.setEnabled(pluginId, publicationId, true, audit);
    await publicationRepo.setEnabled(pluginId, publicationId, true, audit);
    await publicationRepo.setEnabled(pluginId, publicationId, false, audit);
    await publicationRepo.setEnabled(pluginId, publicationId, false, audit);
    expect(await publicationRepo.isEnabled(pluginId, publicationId)).toBe(false);
    const result = await getDbPool().query<{
      action: string; publication_id: string; metadata: unknown;
    }>(
      `SELECT action, publication_id, metadata FROM audit_events
       WHERE actor_user_id = $1 AND publication_id = $2 ORDER BY created_at, id`,
      [actorUserId, publicationId],
    );
    expect(result.rows.map(row => row.action).sort()).toEqual([
      "plugin.publication_disabled", "plugin.publication_enabled",
    ]);
    expect(result.rows.every(row => row.publication_id === publicationId)).toBe(true);
    expect(result.rows.every(row => row.metadata === null)).toBe(true);
    const activity = await listPluginActivity(publicationId, pluginId, 0, 25);
    expect(activity.items.map(row => row.action).sort()).toEqual([
      "plugin.publication_disabled", "plugin.publication_enabled",
    ]);
    expect((await listPluginActivity("other-publication", pluginId, 0, 25)).items)
      .toHaveLength(0);
  });

  it("does not audit a rejected metadata CAS or unsuccessful lifecycle claim", async () => {
    const before = await getDbPool().query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE actor_user_id = $1", [actorUserId],
    );
    const current = await pluginRepo.findById(pluginId);
    if (!current) throw new Error("Missing fixture plugin");
    await expect(pluginRepo.tryUpdateMetadataIfInactive?.(
      pluginId, { version: "2.0.0" },
      { version: "mismatched", updatedAt: current.updatedAt }, audit,
    )).resolves.toBeNull();
    expect(await pluginRepo.tryTransitionStatus(
      pluginId, ["active"], "activating",
    )).toBeNull();
    const after = await getDbPool().query<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE actor_user_id = $1", [actorUserId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
