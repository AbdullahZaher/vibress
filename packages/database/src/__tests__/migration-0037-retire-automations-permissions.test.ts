import { describe, expect, it } from "vitest";
import { getDbPool } from "../connection";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "packages/database/migrations/0037_retire_automations_permissions.sql"),
  "utf8",
);

describe("Migration 0037: retire automations RBAC keys", () => {
  it("removes only retired grants, preserving unrelated permissions and rows", async () => {
    const client = await getDbPool().connect();
    const schema = `retired_automations_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE permissions (id text PRIMARY KEY, key text NOT NULL UNIQUE);
        CREATE TABLE role_permissions (
          role_id text NOT NULL,
          permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE
        );
        CREATE TABLE automations (id text PRIMARY KEY);
        INSERT INTO automations (id) VALUES ('retained');
        INSERT INTO permissions (id, key) VALUES
          ('a', 'automations.read'), ('b', 'automations.manage'),
          ('c', 'automations.run'), ('d', 'posts.read');
        INSERT INTO role_permissions (role_id, permission_id) VALUES
          ('editor', 'a'), ('editor', 'b'), ('editor', 'c'), ('editor', 'd');
      `);
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      const keys = await client.query<{ key: string }>(
        "SELECT key FROM permissions ORDER BY key",
      );
      expect(keys.rows.map((row) => row.key)).toEqual(["posts.read"]);
      const grants = await client.query<{ permission_id: string }>(
        "SELECT permission_id FROM role_permissions",
      );
      expect(grants.rows.map((row) => row.permission_id)).toEqual(["d"]);
      const workflows = await client.query<{ id: string }>("SELECT id FROM automations");
      expect(workflows.rows.map((row) => row.id)).toEqual(["retained"]);
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      const replay = await client.query("SELECT id FROM permissions");
      expect(replay.rowCount).toBe(1);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });
});
