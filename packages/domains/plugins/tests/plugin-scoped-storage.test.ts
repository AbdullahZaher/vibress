import { describe, expect, it, vi } from "vitest";
import { getDbPool, schema } from "@vibress/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PluginPhysicalSchemaMigrationService, pluginPhysicalModelDigest,
  pluginPhysicalMigrationDigest, type ApprovedPluginPhysicalMigration,
} from "../src/application/plugin-storage-migrations";
import {
  PluginScopedStorageService, type PluginStorageRecord,
} from "../src/application/plugin-scoped-storage";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";
import { DrizzlePluginScopedStorageRepository } from "../src/infrastructure/drizzle-plugin-scoped-storage";

function migrationSql(name: string): string {
  const local = path.resolve(__dirname, "../../../database/migrations", name);
  const root = path.resolve(process.cwd(), "packages/database/migrations", name);
  return fs.readFileSync(fs.existsSync(local) ? local : root, "utf8");
}
const migrations = [
  "0040_plugin_publication_states.sql",
  "0041_plugin_publication_settings.sql",
  "0042_plugin_migration_storage_foundation.sql",
  "0043_plugin_storage_physical_models.sql",
].map(migrationSql);
const columns = [
  { name: "title", type: "text", required: true },
  { name: "seats", type: "integer", required: false },
  { name: "visible", type: "boolean", required: false },
  { name: "starts_at", type: "timestamptz", required: false },
] as const;
const model = { key: "courses", columns, schemaSha256: pluginPhysicalModelDigest(columns) };
function plan(manifestId: string): ApprovedPluginPhysicalMigration {
  return {
    manifestId, migrationId: "0001_courses", packageVersion: "1.0.0",
    artifactSha256: "a".repeat(64),
    migrationSha256: pluginPhysicalMigrationDigest([model]),
    models: [model],
  };
}

describe("EXT-203B2 host-bound typed publication storage", () => {
  it("enforces publication, model, plugin, capability and version at every database operation", async () => {
    const client = await getDbPool().connect();
    const ns = "storage_b2_" + randomUUID().replaceAll("-", "");
    try {
      await client.query('CREATE SCHEMA "' + ns + '"');
      await client.query('SET search_path TO "' + ns + '"');
      await client.query(`
        CREATE TABLE publications (id text PRIMARY KEY);
        CREATE TABLE plugins (
          id text PRIMARY KEY, manifest_id text NOT NULL UNIQUE,
          status text NOT NULL, version text NOT NULL,
          capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
        );
        INSERT INTO publications VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins VALUES
          ('plugin-a', 'independent-lms', 'inactive', '1.0.0',
           '["extension.storage.read","extension.storage.write"]'),
          ('plugin-b', 'other-courses', 'inactive', '1.0.0',
           '["extension.storage.read","extension.storage.write"]');
      `);
      for (const ddl of migrations) await client.query(ddl);
      const db = drizzle(client, { schema });
      const migrationService = new PluginPhysicalSchemaMigrationService(
        new DrizzlePluginStorageMigrationRepository(() => db),
      );
      expect(await migrationService.applyApprovedPhysical(plan("independent-lms")))
        .toBe("applied");
      expect(await migrationService.applyApprovedPhysical(plan("other-courses")))
        .toBe("applied");
      await client.query(`
        UPDATE plugins SET status='active';
        INSERT INTO plugin_publication_states (plugin_id,publication_id,enabled)
        VALUES ('plugin-a','pub-a',true), ('plugin-a','pub-b',true),
               ('plugin-b','pub-a',true), ('plugin-b','pub-b',false);
      `);
      const repository = new DrizzlePluginScopedStorageRepository(() => db);
      const a = new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-a" }, [model]);
      const b = new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-b" }, [model]);
      const other = new PluginScopedStorageService(repository,
        { pluginId: "plugin-b", publicationId: "pub-a" }, [model]);

      const created = await a.create("courses", "same-id", {
        title: "مقدمة", seats: 10, visible: true, starts_at: "2026-10-20T09:00:00Z",
      });
      expect(created).toEqual({
        id: "same-id", version: 1,
        fields: { title: "مقدمة", seats: 10, visible: true, starts_at: "2026-10-20T09:00:00.000Z" },
      });
      await b.create("courses", "same-id", { title: "Publication B" });
      expect((await b.get("courses", "same-id"))?.fields.title).toBe("Publication B");
      expect((await a.get("courses", "same-id"))?.fields.title).toBe("مقدمة");
      expect(await other.get("courses", "same-id")).toBeNull();
      expect((await other.create("courses", "same-id", { title: "Separate plugin" }))
        .fields.title).toBe("Separate plugin");

      await expect(a.create("courses", "spoof", {
        title: "Spoof", publication_id: "pub-b",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "spoof", {
        title: "Spoof", id: "foreign",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "bad-record", {
        title: "Bad", seats: 2147483648,
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("courses", "bad-record", {
        title: "Bad", starts_at: "tomorrow",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.create("unknown", "bad-record", {
        title: "No",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_MODEL_DENIED" });
      await expect(a.create("courses", "same-id", { title: "duplicate" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_CONFLICT" });

      // SECURITY REGRESSION: invoke the exported DATABASE ADAPTER directly,
      // bypassing the service guard. A crafted UPDATE must not move content.
      const bound = { pluginId: "plugin-a", publicationId: "pub-a" };
      await expect(repository.update(bound, model, "same-id", 1, {
        publication_id: "pub-b",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(repository.update(bound, model, "same-id", 1, {
        id: "renamed-id",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(repository.update(bound, model, "same-id", 1, {
        version: 99,
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(repository.create(bound, model, "fake-id", {
        publication_id: "pub-b", title: "Forged",
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(repository.create(bound, model, "fake-id", {
        title: "Forged", seats: Number.NaN,
      })).rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(repository.get(bound, model, "../bad")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      await expect(repository.list(bound, model, 1000000)).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      await expect(repository.list(bound, model, -1)).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      await expect(repository.list(bound, model, 2, "../bad")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      expect((await a.get("courses", "same-id"))?.fields.title).toBe("مقدمة");
      expect((await b.get("courses", "same-id"))?.fields.title).toBe("Publication B");
      expect(await b.get("courses", "renamed-id")).toBeNull();
      expect(await b.get("courses", "fake-id")).toBeNull();

      expect((await a.update("courses", "same-id", 1, { title: "Updated" })).version).toBe(2);
      await expect(a.update("courses", "same-id", 1, { title: "stale" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_CONFLICT" });
      await expect(a.update("courses", "missing", 1, { title: "none" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_NOT_FOUND" });
      expect(await a.get("courses", "missing")).toBeNull();
      await a.create("courses", "zz-next", { title: "Next" });
      const page = await a.list("courses", 1);
      expect(page.items.map((item: PluginStorageRecord) => item.id)).toEqual(["same-id"]);
      expect(page.nextCursor).toBe("same-id");
      expect((await a.list("courses", 10, page.nextCursor)).items.map((item) => item.id))
        .toEqual(["zz-next"]);
      await expect(a.list("courses", 51)).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      // Query only approved text fields in this publication. The repository
      // must enforce tenant boundaries and parameterize value/field separately.
      expect((await a.listByText("courses", "title", "Updated", 20)).items
        .map((entry) => entry.id)).toEqual(["same-id"]);
      expect((await b.listByText("courses", "title", "Updated", 20)).items).toEqual([]);
      expect((await other.listByText("courses", "title", "Updated", 20)).items).toEqual([]);
      await expect(a.listByText("courses", "seats", "10")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      await expect(a.listByText("courses", "publication_id", "pub-b")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_INVALID",
      });
      await expect(a.listByText("courses", "title\" OR 1=1 --", "Updated")).rejects
        .toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      await expect(a.listByText("courses", "title", "Updated", 51)).rejects
        .toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });


      // A hostile search_path can expose an unowned same-named relation.
      // The adapter must read the physical table in the owner's schema.
      const physical = await client.query(
        "SELECT table_name FROM plugin_storage_physical_models " +
        "WHERE plugin_id='plugin-a' AND model_key='courses'",
      );
      const physicalName: string = physical.rows[0]?.table_name;
      const shadow = "shadow_" + randomUUID().replaceAll("-", "");
      await client.query('CREATE SCHEMA "' + shadow + '"');
      try {
        await client.query('CREATE TABLE "' + shadow + '"."' + physicalName + '" ' +
          '(publication_id text,id text,version integer,title text,seats integer,' +
          'visible boolean,starts_at timestamptz)');
        await client.query('INSERT INTO "' + shadow + '"."' + physicalName + '" ' +
          '(publication_id,id,version,title) VALUES ($1,$2,$3,$4)',
          ["pub-a", "same-id", 987, "malicious shadow data"]);
        await client.query('SET search_path TO "' + shadow + '","' + ns + '"');
        expect((await a.get("courses", "same-id"))?.fields.title).toBe("Updated");
        expect((await a.get("courses", "same-id"))?.version).toBe(2);
      } finally {
        await client.query('SET search_path TO "' + ns + '"');
        await client.query('DROP SCHEMA "' + shadow + '" CASCADE');
      }

      // Two independent PG sessions: disablement wins against a storage read
      // that is waiting on the locked publication state row.
      const writer = await getDbPool().connect();
      try {
        await writer.query('SET search_path TO "' + ns + '"');
        await writer.query("BEGIN");
        await writer.query(
          "UPDATE plugin_publication_states SET enabled=false " +
          "WHERE plugin_id='plugin-a' AND publication_id='pub-a'",
        );
        const pending = a.get("courses", "same-id");
        // The publication UPDATE lock is still held until commit.
        await new Promise((resolve) => setTimeout(resolve, 50));
        await writer.query("COMMIT");
        await expect(pending).rejects.toMatchObject({ code: "PLUGIN_STORAGE_DENIED" });
      } finally {
        await writer.query("ROLLBACK");
        await writer.query("RESET search_path");
        writer.release();
      }
      await client.query(
        "UPDATE plugin_publication_states SET enabled=true " +
        "WHERE plugin_id='plugin-a' AND publication_id='pub-a'",
      );
      expect((await a.get("courses", "same-id"))?.version).toBe(2);

      await client.query(`
        UPDATE plugin_publication_states SET enabled=false
        WHERE plugin_id='plugin-a' AND publication_id='pub-b';
      `);
      await expect(b.get("courses", "same-id")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_DENIED",
      });
      await client.query(`
        UPDATE plugins SET capabilities='["extension.storage.read"]'::jsonb
        WHERE id='plugin-a';
      `);
      expect((await a.get("courses", "same-id"))?.version).toBe(2);
      await expect(a.update("courses", "same-id", 2, { title: "Denied" }))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_DENIED" });
      await client.query("UPDATE plugins SET status='inactive' WHERE id='plugin-a'");
      await expect(a.get("courses", "same-id")).rejects.toMatchObject({
        code: "PLUGIN_STORAGE_DENIED",
      });
      // Keep persisted rows on disable and later reactivation.
      await client.query(`
        UPDATE plugins SET status='active',
          capabilities='["extension.storage.read","extension.storage.write"]'::jsonb
        WHERE id='plugin-a';
      `);
      expect((await a.get("courses", "same-id"))?.fields.title).toBe("Updated");
      // Atomic, actor-bound audit: a failed audit insert MUST roll back
      // the storage mutation. No plugin field values enter audit metadata.
      await client.query(`
        CREATE TABLE audit_events (
          id text PRIMARY KEY, publication_id text,
          actor_user_id text NOT NULL CHECK (actor_user_id <> 'staff-denied'),
          request_id text, action text NOT NULL,
          target_type text, target_id text, metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const withAudit = new PluginScopedStorageService(repository, {
        pluginId: "plugin-a", publicationId: "pub-a",
        audit: { actorUserId: "staff-1", requestId: "req-1" },
      }, [model]);
      const audited = await withAudit.create("courses", "audit-course", {
        title: "private enrollment content",
      });
      expect(audited.version).toBe(1);
      expect((await withAudit.update("courses", "audit-course", 1, {
        title: "updated private data",
      })).version).toBe(2);
      const audits = await client.query(
        "SELECT publication_id, actor_user_id, request_id, action, " +
        "target_id, metadata FROM audit_events ORDER BY created_at, action",
      );
      expect(audits.rows).toHaveLength(2);
      expect(audits.rows.map((row) => row.action).sort()).toEqual([
        "plugin.storage.create", "plugin.storage.update",
      ]);
      for (const row of audits.rows) {
        expect(row).toMatchObject({
          publication_id: "pub-a", actor_user_id: "staff-1",
          request_id: "req-1", target_id: "audit-course",
          metadata: { pluginId: "plugin-a", modelKey: "courses" },
        });
      }
      expect(JSON.stringify(audits.rows)).not.toContain("private enrollment content");
      expect(JSON.stringify(audits.rows)).not.toContain("updated private data");

      const failingAudit = new PluginScopedStorageService(repository, {
        pluginId: "plugin-a", publicationId: "pub-a",
        audit: { actorUserId: "staff-denied", requestId: "req-2" },
      }, [model]);
      await expect(failingAudit.create("courses", "audit-rollback", {
        title: "Must never persist",
      })).rejects.toThrow();
      expect(await withAudit.get("courses", "audit-rollback")).toBeNull();
      await expect(failingAudit.update("courses", "audit-course", 2, {
        title: "Must roll back update",
      })).rejects.toThrow();
      expect((await withAudit.get("courses", "audit-course"))?.version).toBe(2);
      expect((await client.query("SELECT count(*)::int AS n FROM audit_events")).rows[0]?.n)
        .toBe(2);

      // DB metadata digest alone cannot detect an out-of-band ALTER.
      // Reject tampered physical structure, preserving existing rows.
      await client.query('ALTER TABLE "' + physicalName + '" ADD COLUMN unapproved text');
      await expect(withAudit.get("courses", "audit-course"))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SCHEMA_DRIFT" });
      await client.query('ALTER TABLE "' + physicalName + '" DROP COLUMN unapproved');
      await client.query('ALTER TABLE "' + physicalName +
        '" DROP CONSTRAINT "' + physicalName + '_pkey"');
      await expect(withAudit.get("courses", "audit-course"))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SCHEMA_DRIFT" });
      await client.query('ALTER TABLE "' + physicalName +
        '" ADD PRIMARY KEY ("publication_id","id")');
      const foreign = await client.query(
        'SELECT conname FROM pg_constraint ' +
        'WHERE conrelid = $1::regclass AND contype = $2',
        [physicalName, "f"],
      );
      const fkName: string = foreign.rows[0]?.conname;
      expect(fkName).toMatch(/^[a-z0-9_]+$/);
      await client.query('ALTER TABLE "' + physicalName +
        '" DROP CONSTRAINT "' + fkName + '"');
      await expect(withAudit.get("courses", "audit-course"))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_SCHEMA_DRIFT" });
      await client.query('ALTER TABLE "' + physicalName +
        '" ADD FOREIGN KEY ("publication_id") REFERENCES publications(id) ON DELETE CASCADE');
      expect((await withAudit.get("courses", "audit-course"))?.version).toBe(2);

      const wrongSchema = { ...model, schemaSha256: "b".repeat(64) };
      expect(() => new PluginScopedStorageService(repository,
        { pluginId: "plugin-a", publicationId: "pub-a" }, [wrongSchema]))
        .toThrow(expect.objectContaining({ code: "PLUGIN_STORAGE_INVALID" }));
      const oldMapping = await client.query(
        "SELECT count(*)::int AS n FROM plugin_schema_migrations",
      );
      expect(oldMapping.rows[0]?.n).toBe(2);
    } finally {
      await client.query("RESET search_path");
      await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });

  it("refuses malformed requests before contacting the repository", async () => {
    const repository = {
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ items: [] })),
      create: vi.fn(async () => ({ id: "x", version: 1, fields: { title: "x" } })),
      update: vi.fn(async () => ({ id: "x", version: 2, fields: { title: "x" } })),
    };
    const service = new PluginScopedStorageService(repository,
      { pluginId: "plugin-a", publicationId: "pub-a" }, [model]);
    await expect(service.create("courses", "../bad", { title: "x" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.create("courses", "valid", { seats: 2 }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.update("courses", "valid", 0, { title: "new" }))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.update("courses", "valid", 1, {}))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    await expect(service.list("courses", 1, "../escape"))
      .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
  });
});
