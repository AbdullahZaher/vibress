import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { getDbPool } from "../connection";

const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), "packages/database/migrations/0034_import_export_publication_isolation.sql"),
  "utf8",
);

async function setup(client: PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (id text PRIMARY KEY);
    CREATE TABLE import_export_jobs (
      id text PRIMARY KEY,
      type text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      requested_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO publications (id) VALUES ('pub_default'), ('pub_alpha');
    INSERT INTO import_export_jobs (id, type) VALUES
      ('legacy-export', 'export'), ('legacy-import', 'import');
  `);
}

async function cleanup(client: PoolClient, schema: string) {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0034 publication-owned import/export jobs", () => {
  it("preserves legacy job IDs and assigns default ownership", async () => {
    const client = await getDbPool().connect();
    const schema = `job_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await setup(client, schema);
      await client.query(migrationSql);
      const rows = await client.query<{id: string; publication_id: string}>(
        "SELECT id, publication_id FROM import_export_jobs ORDER BY id",
      );
      expect(rows.rows).toEqual([
        { id: "legacy-export", publication_id: "pub_default" },
        { id: "legacy-import", publication_id: "pub_default" },
      ]);

      await client.query(`
        INSERT INTO import_export_jobs (id, type, publication_id)
        VALUES ('new-alpha', 'export', 'pub_alpha');
      `);
      const owner = await client.query<{publication_id: string}>(
        "SELECT publication_id FROM import_export_jobs WHERE id='new-alpha'",
      );
      expect(owner.rows[0]?.publication_id).toBe("pub_alpha");
      await expect(client.query(`
        INSERT INTO import_export_jobs (id, type, publication_id)
        VALUES ('invalid', 'export', 'missing');
      `)).rejects.toMatchObject({code: "23503"});
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });

  it("removes a deleted publication's jobs without deleting default jobs", async () => {
    const client = await getDbPool().connect();
    const schema = `job_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await setup(client, schema);
      await client.query(migrationSql);
      await client.query(`
        INSERT INTO import_export_jobs (id, type, publication_id)
        VALUES ('new-alpha', 'export', 'pub_alpha');
        DELETE FROM publications WHERE id = 'pub_alpha';
      `);
      const rows = await client.query<{id: string}>("SELECT id FROM import_export_jobs ORDER BY id");
      expect(rows.rows.map(r=>r.id)).toEqual(["legacy-export", "legacy-import"]);
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
