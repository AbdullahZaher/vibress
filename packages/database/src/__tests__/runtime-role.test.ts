import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { getConfig } from "@vibress/config";
import { provisionRuntimeRole, readRuntimeRoleConfig } from "../runtime-role";

describe("runtime role configuration", () => {
  it("is skipped without a password", () => {
    expect(readRuntimeRoleConfig({})).toBeNull();
    expect(readRuntimeRoleConfig({ POSTGRES_APP_USER: "vibress_app" })).toBeNull();
  });

  it("defaults the role name and accepts a valid override", () => {
    expect(
      readRuntimeRoleConfig({ POSTGRES_APP_PASSWORD: "secret" }),
    ).toEqual({ roleName: "vibress_app", password: "secret" });
    expect(
      readRuntimeRoleConfig({
        POSTGRES_APP_PASSWORD: "secret",
        POSTGRES_APP_USER: "runtime_user_1",
      }),
    ).toEqual({ roleName: "runtime_user_1", password: "secret" });
  });

  it("rejects a role name that could require identifier quoting", () => {
    expect(() =>
      readRuntimeRoleConfig({
        POSTGRES_APP_PASSWORD: "secret",
        POSTGRES_APP_USER: 'bad"name',
      }),
    ).toThrow();
  });
});

const roleName = `vibress_app_test_${Date.now().toString(36)}`;
const password = `probe-${Date.now().toString(36)}`;

describe("least-privilege runtime role", () => {
  let owner: Client;
  let runtime: Client;
  let runtimeConnected = false;

  beforeAll(async () => {
    owner = new Client({ connectionString: getConfig().database.url });
    await owner.connect();
    await provisionRuntimeRole(owner, { roleName, password });

    const url = new URL(getConfig().database.url);
    url.username = roleName;
    url.password = password;
    runtime = new Client({ connectionString: url.toString() });
    await runtime.connect();
    runtimeConnected = true;
  });

  afterAll(async () => {
    if (runtimeConnected) {
      await runtime.end();
    }
    if (owner) {
      const role = owner.escapeIdentifier(roleName);
      await owner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`,
      );
      await owner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`,
      );
      await owner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${role}`,
      );
      // Removes remaining grants and any tables the probe role created.
      await owner.query(`DROP OWNED BY ${role}`);
      await owner.query(`DROP ROLE ${role}`);
      await owner.end();
    }
  });

  it("is a non-privileged login role", async () => {
    const res = await owner.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [roleName],
    );
    expect(res.rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
  });

  it("refuses to manage the migration/owner role", async () => {
    const current = await owner.query<{ user: string }>(
      "SELECT current_user AS user",
    );
    await expect(
      provisionRuntimeRole(owner, {
        roleName: current.rows[0]!.user,
        password: "irrelevant",
      }),
    ).rejects.toThrow(/differ from the migration\/owner role/);
  });

  it("has DML on core tables but not ownership", async () => {
    const res = await owner.query(
      `SELECT has_table_privilege($1, 'public.publications', 'SELECT') AS sel,
              has_table_privilege($1, 'public.publications', 'INSERT') AS ins,
              has_table_privilege($1, 'public.publications', 'UPDATE') AS upd,
              has_table_privilege($1, 'public.publications', 'DELETE') AS del,
              has_table_privilege($1, 'public.publications', 'TRUNCATE') AS trunc,
              pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c
         WHERE c.oid = 'public.publications'::regclass`,
      [roleName],
    );
    expect(res.rows[0]).toMatchObject({
      sel: true,
      ins: true,
      upd: true,
      del: true,
      trunc: false,
    });
    expect(res.rows[0]!.owner).not.toBe(roleName);
  });

  it("reads application data and cannot drop a core table", async () => {
    const read = await runtime.query(
      "SELECT count(*)::int AS count FROM publications",
    );
    expect(read.rows[0]!.count).toBeGreaterThanOrEqual(0);

    await expect(
      runtime.query('DROP TABLE "publications"'),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("can create and drop its own plugin storage table", async () => {
    await runtime.query(
      'CREATE TABLE "runtime_role_probe" ("id" text PRIMARY KEY)',
    );
    await runtime.query('DROP TABLE "runtime_role_probe"');
  });
});
