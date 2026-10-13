import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const sql = fs.readFileSync(
  path.resolve(process.cwd(), "packages/database/migrations/0035_redirect_publication_isolation.sql"),
  "utf8",
);

async function setup(client: PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}", public`);
  await client.query(`
    CREATE TABLE publications (id text PRIMARY KEY);
    CREATE TABLE redirects (
      id text PRIMARY KEY,
      source text NOT NULL,
      destination text NOT NULL,
      enabled boolean NOT NULL DEFAULT true
    );
    ALTER TABLE redirects ADD CONSTRAINT redirects_source_unique UNIQUE(source);
    INSERT INTO publications (id) VALUES ('pub_default'), ('pub_alpha');
    INSERT INTO redirects (id, source, destination)
      VALUES ('legacy', '/shared', '/old-target');
  `);
}

async function cleanup(client: PoolClient, schema: string) {
  await client.query("ROLLBACK");
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

describe("migration 0035 publication-owned redirects", () => {
  it("retains legacy IDs, assigns default ownership and allows same source in another publication", async () => {
    const client = await getDbPool().connect();
    const schema = `redirect_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await setup(client, schema);
      await client.query(sql);
      const rows = await client.query<{id: string; publication_id: string; source: string}>(
        "SELECT id, publication_id, source FROM redirects WHERE id='legacy'",
      );
      expect(rows.rows).toEqual([{ id: "legacy", publication_id: "pub_default", source: "/shared" }]);
      await client.query(`
        INSERT INTO redirects (id, publication_id, source, destination)
        VALUES ('alpha', 'pub_alpha', '/shared', '/alpha-target');
      `);
      await expect(client.query(`
        INSERT INTO redirects (id, publication_id, source, destination)
        VALUES ('duplicate', 'pub_alpha', '/shared', '/collision');
      `)).rejects.toMatchObject({ code: "23505" });
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });

  it("cascades deleted publication's redirects without affecting default rules", async () => {
    const client = await getDbPool().connect();
    const schema = `redirect_upgrade_${randomUUID().replaceAll("-", "")}`;
    try {
      await setup(client, schema);
      await client.query(sql);
      await client.query(`
        INSERT INTO redirects (id, publication_id, source, destination)
        VALUES ('alpha', 'pub_alpha', '/shared', '/alpha-target');
        DELETE FROM publications WHERE id = 'pub_alpha';
      `);
      const rows = await client.query<{id: string}>("SELECT id FROM redirects");
      expect(rows.rows.map(r => r.id)).toEqual(["legacy"]);
    } finally {
      await cleanup(client, schema);
      client.release();
    }
  });
});
