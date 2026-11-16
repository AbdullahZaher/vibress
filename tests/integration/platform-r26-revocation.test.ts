// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * R26 proposal verification (Scope A) in a disposable database.
 *
 * The approved-for-application SQL lives in
 * docs/platform-roadmap/execution/proposals/0055_revoke_public_execute.sql and
 * is intentionally outside the migration journal. This test reads that file,
 * substitutes the placeholder migration owner and executes it against a
 * throwaway database owned by a non-superuser role. The shared dev database is
 * never modified, and no approval is implied: the proposal stays unapplied.
 *
 * It proves the effect the approval request asks the database owner to accept:
 * PUBLIC execute is closed for the migration-created trigger functions, future
 * owner-created functions are closed by default, extension functions keep their
 * PUBLIC grant (accepted residual R26-EXT), trigger execution does not need a
 * runtime EXECUTE, the fail-closed check refuses an unreviewed function, and the
 * rollback restores the previous state.
 */
const BASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const suffix = Date.now().toString(36);
const databaseName = `vibress_r26_${suffix}`;
const ownerRole = `r26_owner_${suffix}`;
const callerRole = `r26_caller_${suffix}`;
const ownerPassword = `owner_${suffix}`;
const callerPassword = `caller_${suffix}`;

const proposalPath = path.resolve(
  process.cwd(),
  "docs/platform-roadmap/execution/proposals/0055_revoke_public_execute.sql",
);

function urlFor(role: string, password: string): string {
  const url = new URL(BASE_URL);
  url.username = role;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function databaseUrl(): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function renderApplySql(owner: string): string {
  const proposal = fs.readFileSync(proposalPath, "utf8");
  const start = proposal.indexOf("BEGIN;");
  const end = proposal.indexOf("COMMIT;");
  if (start < 0 || end < start) {
    throw new Error("proposal 0055 apply section was not found");
  }
  const body = proposal.slice(start, end + "COMMIT;".length);
  if (!body.includes("<MIGRATION_OWNER>")) {
    throw new Error("proposal 0055 placeholder was not found");
  }
  return body.split("<MIGRATION_OWNER>").join(owner);
}

function renderRollbackSql(owner: string): string {
  const proposal = fs.readFileSync(proposalPath, "utf8");
  // The rollback is a commented block; the banner line above it is prose, so
  // extract from its BEGIN to its COMMIT and strip the comment prefixes.
  const marker = proposal.indexOf("-- ROLLBACK");
  const begin = proposal.indexOf("BEGIN;", marker);
  const end = proposal.indexOf("COMMIT;", begin);
  if (marker < 0 || begin < 0 || end < begin) {
    throw new Error("proposal 0055 rollback section was not found");
  }
  const body = proposal
    .slice(begin, end + "COMMIT;".length)
    .split("\n")
    .map((line) => line.replace(/^\s*--\s?/, ""))
    .join("\n");
  return body.split("<MIGRATION_OWNER>").join(owner);
}

const triggerFunction = "public.prevent_comment_moderation_events_mutation()";
const secondTriggerFunction =
  "public.vibress_plugin_storage_append_only()";

let admin: Client;
let databaseAdmin: Client;
let owner: Client;
let caller: Client;

async function publicExecute(role: string, signature: string): Promise<boolean> {
  const result = await databaseAdmin.query<{ allowed: boolean }>(
    "SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed",
    [role, signature],
  );
  return result.rows[0]?.allowed === true;
}

async function ownerDefaultFunctionAcl(): Promise<{
  present: boolean;
  publicExecute: boolean;
}> {
  // A schema-scoped entry cannot remove the hard-wired PUBLIC EXECUTE, so the
  // proposal must store a global entry (defaclnamespace = 0).
  const result = await databaseAdmin.query<{
    publicExecute: boolean;
  }>(
    `SELECT EXISTS (
              SELECT 1
                FROM aclexplode(d.defaclacl) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            ) AS "publicExecute"
       FROM pg_default_acl d
      WHERE d.defaclnamespace = 0
        AND d.defaclobjtype = 'f'
        AND pg_get_userbyid(d.defaclrole) = $1`,
    [ownerRole],
  );
  const row = result.rows[0];
  return { present: row !== undefined, publicExecute: row?.publicExecute === true };
}

beforeAll(async () => {
  admin = new Client({ connectionString: BASE_URL });
  await admin.connect();

  const current = await admin.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  if (!current.rows[0]?.rolsuper) {
    throw new Error(
      "R26 proposal verification requires a superuser connection to create the disposable database and roles",
    );
  }

  await admin.query(
    `CREATE ROLE ${admin.escapeIdentifier(ownerRole)} LOGIN PASSWORD ${admin.escapeLiteral(ownerPassword)}
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(
    `CREATE ROLE ${admin.escapeIdentifier(callerRole)} LOGIN PASSWORD ${admin.escapeLiteral(callerPassword)}
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(
    `CREATE DATABASE ${admin.escapeIdentifier(databaseName)} OWNER ${admin.escapeIdentifier(ownerRole)}`,
  );

  databaseAdmin = new Client({ connectionString: databaseUrl() });
  await databaseAdmin.connect();
  owner = new Client({
    connectionString: urlFor(ownerRole, ownerPassword),
  });
  await owner.connect();

  await owner.query(
    `CREATE FUNCTION public.prevent_comment_moderation_events_mutation()
       RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       NEW.note := 'trigger-ran';
       RETURN NEW;
     END
     $fn$`,
  );
  await owner.query(
    `CREATE FUNCTION public.vibress_plugin_storage_append_only()
       RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       RETURN NEW;
     END
     $fn$`,
  );
  await owner.query(
    `CREATE TABLE public.r26_probe (id serial PRIMARY KEY, note text)`,
  );
  await owner.query(
    `CREATE TRIGGER r26_probe_before_insert
       BEFORE INSERT ON public.r26_probe
       FOR EACH ROW
       EXECUTE FUNCTION public.prevent_comment_moderation_events_mutation()`,
  );
  await owner.query(
    `GRANT INSERT, SELECT ON public.r26_probe TO ${databaseAdmin.escapeIdentifier(callerRole)}`,
  );
  await owner.query(
    `GRANT USAGE ON SEQUENCE public.r26_probe_id_seq TO ${databaseAdmin.escapeIdentifier(callerRole)}`,
  );

  // Extension functions created by the bootstrap superuser keep PUBLIC execute;
  // the proposal intentionally does not revoke them (accepted residual R26-EXT).
  await databaseAdmin.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  caller = new Client({ connectionString: urlFor(callerRole, callerPassword) });
  await caller.connect();
});

afterAll(async () => {
  await caller?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await databaseAdmin?.end().catch(() => undefined);
  if (admin) {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      )
      .catch(() => undefined);
    await admin
      .query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(databaseName)}`)
      .catch(() => undefined);
    for (const role of [callerRole, ownerRole]) {
      await admin
        .query(`DROP ROLE IF EXISTS ${admin.escapeIdentifier(role)}`)
        .catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
});

describe("R26 proposal 0055 in an isolated database", () => {
  it("starts with PUBLIC execute on the owner-created trigger functions", async () => {
    expect(await publicExecute(callerRole, triggerFunction)).toBe(true);
    expect(await publicExecute(callerRole, secondTriggerFunction)).toBe(true);
    expect((await ownerDefaultFunctionAcl()).present).toBe(false);
  });

  it("closes PUBLIC execute, future owner functions and keeps triggers working", async () => {
    await databaseAdmin.query(renderApplySql(ownerRole));

    expect(await publicExecute(callerRole, triggerFunction)).toBe(false);
    expect(await publicExecute(callerRole, secondTriggerFunction)).toBe(false);

    const acl = await ownerDefaultFunctionAcl();
    expect(acl).toEqual({ present: true, publicExecute: false });

    // A function created by the owner after the default ACL change is closed.
    await owner.query(
      `CREATE FUNCTION public.r26_owner_scalar() RETURNS text
         LANGUAGE sql STABLE AS 'SELECT current_user::text'`,
    );
    expect(await publicExecute(callerRole, "public.r26_owner_scalar()")).toBe(
      false,
    );
    await expect(caller.query("SELECT public.r26_owner_scalar()")).rejects.toMatchObject(
      { code: "42501" },
    );

    // The entry is global: owner-created functions outside schema public are
    // closed too. This is the documented blast radius of the global form.
    await databaseAdmin.query(
      `CREATE SCHEMA r26_other AUTHORIZATION ${databaseAdmin.escapeIdentifier(ownerRole)}`,
    );
    await owner.query(
      `CREATE FUNCTION r26_other.r26_owner_scalar() RETURNS text
         LANGUAGE sql STABLE AS 'SELECT current_user::text'`,
    );
    expect(
      await publicExecute(callerRole, "r26_other.r26_owner_scalar()"),
    ).toBe(false);

    // Accepted residual: extension functions stay PUBLIC-executable.
    expect(await publicExecute(callerRole, "similarity(text,text)")).toBe(true);

    // Trigger execution does not require runtime EXECUTE.
    const inserted = await caller.query<{ note: string }>(
      "INSERT INTO public.r26_probe (note) VALUES ('seed') RETURNING note",
    );
    expect(inserted.rows[0]?.note).toBe("trigger-ran");
  });

  it("fails closed when an unreviewed function is still PUBLIC-executable", async () => {
    // Created by the bootstrap superuser, not the migration owner: the owner
    // default entry does not cover it, so it stays PUBLIC-executable. That is
    // exactly why the inventory must be re-run per release.
    await databaseAdmin.query(
      `CREATE FUNCTION public.r26_unreviewed_probe() RETURNS integer
         LANGUAGE sql AS 'SELECT 1'`,
    );
    try {
      expect(
        await publicExecute(callerRole, "public.r26_unreviewed_probe()"),
      ).toBe(true);
      await expect(
        databaseAdmin.query(renderApplySql(ownerRole)),
      ).rejects.toThrow(/still executable by PUBLIC/);
      await databaseAdmin.query("ROLLBACK").catch(() => undefined);
    } finally {
      await databaseAdmin.query(
        "DROP FUNCTION IF EXISTS public.r26_unreviewed_probe()",
      );
    }

    // Re-running after the unreviewed object is gone is idempotent.
    await databaseAdmin.query(renderApplySql(ownerRole));
    expect(await publicExecute(callerRole, triggerFunction)).toBe(false);
  });

  it("rolls back to the previous PUBLIC state", async () => {
    await databaseAdmin.query(renderRollbackSql(ownerRole));

    expect(await publicExecute(callerRole, triggerFunction)).toBe(true);
    expect(await publicExecute(callerRole, secondTriggerFunction)).toBe(true);

    // Granting PUBLIC back makes the stored entry equal the hard-wired
    // default, so PostgreSQL removes it; the effective default is restored.
    expect(await ownerDefaultFunctionAcl()).toEqual({
      present: false,
      publicExecute: false,
    });

    // Existing objects keep the ACL they were created with; a function created
    // after the rollback gets the restored PUBLIC default again.
    await owner.query(
      `CREATE FUNCTION public.r26_after_rollback() RETURNS text
         LANGUAGE sql STABLE AS 'SELECT current_user::text'`,
    );
    const executed = await caller.query<{ executed_as: string }>(
      "SELECT public.r26_after_rollback() AS executed_as",
    );
    expect(executed.rows[0]?.executed_as).toBe(callerRole);
    await owner.query("DROP FUNCTION IF EXISTS public.r26_after_rollback()");
  });
});
