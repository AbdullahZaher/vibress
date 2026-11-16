// @vitest-environment node
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Read-only R26 regression guards over the public schema.
 *
 * These assert invariants that must hold regardless of whether the proposed
 * PUBLIC-EXECUTE revocation has been applied yet.
 */
const DATABASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");
});

afterAll(async () => {
  await client?.end().catch(() => undefined);
});

describe("public function privileges (R26)", () => {
  it("exposes no SECURITY DEFINER function through PUBLIC EXECUTE", async () => {
    const result = await client.query<{ signature: string; owner: string }>(
      `SELECT p.oid::regprocedure::text AS signature,
              pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND has_function_privilege('public', p.oid, 'EXECUTE')
        ORDER BY 1`,
    );
    expect(result.rows).toEqual([]);
  });

  it("keeps runtime roles out of function ownership", async () => {
    const result = await client.query<{ signature: string; owner: string }>(
      `SELECT p.oid::regprocedure::text AS signature,
              pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND pg_get_userbyid(p.proowner) IN ('vibress_app', 'vibress_platform_app')
        ORDER BY 1`,
    );
    expect(result.rows).toEqual([]);
  });
});
