import { describe, expect, it } from "vitest";
import { getDbPool, schema } from "@vibress/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PluginPhysicalSchemaMigrationService, pluginPhysicalModelDigest,
  pluginPhysicalMigrationDigest,
} from "../src/application/plugin-storage-migrations";
import { DrizzlePluginStorageMigrationRepository } from "../src/infrastructure/drizzle-plugin-storage-migrations";
import { DrizzlePluginMemberStorageRepository } from "../src/infrastructure/drizzle-plugin-member-storage";

function migrationSql(name: string): string {
  const local = path.resolve(__dirname, "../../../database/migrations", name);
  const root = path.resolve(process.cwd(), "packages/database/migrations", name);
  return fs.readFileSync(fs.existsSync(local) ? local : root, "utf8");
}
const migrations = [
  "0040_plugin_publication_states.sql",
  "0042_plugin_migration_storage_foundation.sql",
  "0043_plugin_storage_physical_models.sql",
  "0045_plugin_member_records.sql",
].map(migrationSql);

const columns = [
  { name: "course_key", type: "text", required: true },
  { name: "completed", type: "boolean", required: false },
] as const;
const model = { key: "enrollment", columns,
  schemaSha256: pluginPhysicalModelDigest(columns) };

describe("EXT-205 live PostgreSQL Member storage", () => {
  it("isolates owners, denies foreign Members and disabled sites, and CAS-updates atomically", async () => {
    const client = await getDbPool().connect();
    const ns = "member_store_" + randomUUID().replaceAll("-", "");
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
        CREATE TABLE members (
          id text PRIMARY KEY,
          publication_id text NOT NULL REFERENCES publications(id),
          status text NOT NULL
        );
        CREATE TABLE audit_events (
          id text PRIMARY KEY,
          publication_id text,
          actor_user_id text,
          request_id text NOT NULL,
          action text NOT NULL,
          target_type text NOT NULL,
          target_id text,
          ip_address text,
          user_agent text,
          metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO publications VALUES ('pub-a'), ('pub-b');
        INSERT INTO plugins VALUES (
          'plugin-a', 'course-plugin', 'inactive', '1.0.0',
          '["extension.member_storage.read","extension.member_storage.write"]'::jsonb
        );
        INSERT INTO members VALUES
          ('member-a', 'pub-a', 'active'), ('member-a2', 'pub-a', 'active'),
          ('member-b', 'pub-b', 'active'), ('member-disabled', 'pub-a', 'disabled');
      `);
      for (const migration of migrations) await client.query(migration);
      const db = drizzle(client, { schema });
      const migrator = new PluginPhysicalSchemaMigrationService(
        new DrizzlePluginStorageMigrationRepository(() => db),
      );
      const approved = {
        manifestId: "course-plugin", migrationId: "0001_courses",
        packageVersion: "1.0.0", artifactSha256: "a".repeat(64),
        migrationSha256: pluginPhysicalMigrationDigest([model]),
        models: [model],
      };
      expect(await migrator.applyApprovedPhysical(approved)).toBe("applied");
      await client.query(`
        UPDATE plugins SET status='active';
        INSERT INTO plugin_publication_states (plugin_id, publication_id, enabled)
        VALUES ('plugin-a','pub-a',true), ('plugin-a','pub-b',true);
      `);
      const repo = new DrizzlePluginMemberStorageRepository(() => db);
      const a = { pluginId: "plugin-a", publicationId: "pub-a",
        memberId: "member-a", requestId: "req-a", allowWrites: true };
      const a2 = { ...a, memberId: "member-a2", requestId: "req-a2" };
      const b = { ...a, publicationId: "pub-b", memberId: "member-b", requestId: "req-b" };

      const first = await repo.create(a, model, "course-1", { course_key: "دورة", completed: false });
      expect(first).toMatchObject({ id: "course-1", version: 1,
        fields: { course_key: "دورة", completed: false } });
      expect(await repo.get(a2, model, "course-1")).toBeNull();
      // DB-level tenant integrity: an out-of-band SQL writer cannot associate
      // a Member from B with a plugin publication in A.
      await expect(client.query(`
        INSERT INTO plugin_member_records
          (plugin_id,publication_id,member_id,model_key,record_id,fields)
        VALUES ('plugin-a','pub-a','member-b','enrollment','tampered',
          '{"course_key":"forged"}'::jsonb)
      `)).rejects.toMatchObject({ code: "23503" });
      // A disable/enable lifecycle cannot accidentally purge stored content.
      await expect(client.query(`
        DELETE FROM plugin_publication_states
        WHERE plugin_id='plugin-a' AND publication_id='pub-a'
      `)).rejects.toMatchObject({ code: "23503" });
      expect(await repo.get(b, model, "course-1")).toBeNull();
      await expect(repo.get({ ...a, memberId: "member-b" }, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      await expect(repo.get({ ...a, publicationId: "pub-b" }, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      await expect(repo.get({ ...a, memberId: "member-disabled" }, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      await expect(repo.update(a2, model, "course-1", 1, { completed: true }))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_NOT_FOUND" });
      await expect(repo.create(a, model, "course-1", { course_key: "duplicate" }))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_CONFLICT" });
      await repo.create(a2, model, "course-1", { course_key: "independent" });
      await repo.create(b, model, "course-1", { course_key: "independent pub" });
      expect((await repo.update(a, model, "course-1", 1, { completed: true })).version).toBe(2);
      await expect(repo.update(a, model, "course-1", 1, { completed: false }))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_CONFLICT" });
      expect((await repo.get(a2, model, "course-1"))?.fields.course_key).toBe("independent");
      await repo.create(a, model, "course-2", { course_key: "next" });
      const firstPage = await repo.list(a, model, 1);
      expect(firstPage.items.map((item) => item.id)).toEqual(["course-1"]);
      expect(firstPage.nextCursor).toBe("course-1");
      expect((await repo.list(a, model, 1, firstPage.nextCursor)).items
        .map((item) => item.id)).toEqual(["course-2"]);
      expect((await repo.list(b, model, 10)).items).toHaveLength(1);
      await expect(repo.list(a, model, 51))
        .rejects.toMatchObject({ code: "PLUGIN_STORAGE_INVALID" });
      // Auditing must be in the same transaction: a failed audit cannot
      // leave a completed enrollment/progress write behind.
      await client.query(`ALTER TABLE audit_events ADD CONSTRAINT reject_member_audit
        CHECK (request_id <> 'req-reject')`);
      await expect(repo.create({ ...a, requestId: "req-reject" }, model, "not-committed", {
        course_key: "rollback",
      })).rejects.toThrow();
      expect(await repo.get(a, model, "not-committed")).toBeNull();
      // An explicit Member deletion cascades only that Member's own records.
      await client.query("DELETE FROM members WHERE id='member-a2'");
      await expect(repo.get(a2, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      expect((await repo.get(a, model, "course-1"))?.fields.course_key).toBe("دورة");
      await expect(repo.create({ ...a, allowWrites: false }, model, "course-2", {
        course_key: "denied",
      })).rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_METHOD_DENIED" });

      await client.query("UPDATE plugin_publication_states SET enabled=false WHERE publication_id='pub-b'");
      await expect(repo.get(b, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      await client.query(`UPDATE plugins SET capabilities='["extension.member_storage.read"]'::jsonb`);
      await expect(repo.create(a, model, "course-2", { course_key: "denied" }))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      await client.query("UPDATE plugins SET status='inactive'");
      await expect(repo.get(a, model, "course-1"))
        .rejects.toMatchObject({ code: "PLUGIN_MEMBER_STORAGE_DENIED" });
      const audits = await client.query("SELECT metadata, action, target_id FROM audit_events");
      expect(audits.rows).toHaveLength(5);
      expect(JSON.stringify(audits.rows)).not.toContain("member-a");
      expect(JSON.stringify(audits.rows)).not.toContain("دورة");
    } finally {
      await client.query("RESET search_path");
      await client.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE');
      client.release();
    }
  });
});
