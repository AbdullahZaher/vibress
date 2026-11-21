/**
 * Test-only crash boundary. Never imported/exported by runtime.
 * Runs solely against a disposable localhost vibress_s03_* PostgreSQL DB.
 * The parent sends SIGKILL after receiving AFTER_DDL over IPC.
 */
import { Client } from "pg";
import { executeApprovedAdditiveColumn } from "../../../tests/fixtures/m03-s03-legacy-operator-diagnostic";

const url = process.env.M03_S03_FAULT_DATABASE_URL ?? "";
const installationId = process.env.M03_S03_FAULT_INSTALLATION ?? "";
const planDigest = process.env.M03_S03_FAULT_PLAN_DIGEST ?? "";
const parsed = new URL(url);
if (process.env.M03_S03_DISPOSABLE_CONFIRM !== "I_CONFIRM_DISPOSABLE" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "5433" ||
    !/^\/vibress_s03_[a-z]_[0-9a-f]{8}$/.test(parsed.pathname) ||
    !/^s03-[a-z]$/.test(installationId) ||
    !/^[0-9a-f]{64}$/.test(planDigest)) {
  throw new Error("FAULT_CHILD_REFUSES_NONDISPOSABLE_TARGET");
}

const client = new Client({
  connectionString: url, connectionTimeoutMillis: 4000,
  query_timeout: 12000, statement_timeout: 10000,
});
client.on("error", () => undefined);

async function main() {
  await client.connect();
  const wrapped = new Proxy(client, {
    get(target, key) {
      if (key !== "query") {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (query: string, params?: unknown[]) => {
        const result = params === undefined
          ? await target.query(query)
          : await target.query(query, params);
        if (/^ALTER TABLE/i.test(query)) {
          process.send?.({ phase: "AFTER_PHYSICAL_DDL", mechanism: "SIGKILL_BARRIER" });
          await new Promise<never>(() => undefined);
        }
        return result;
      };
    },
  }) as Client;
  await executeApprovedAdditiveColumn(wrapped, { installationId, planDigest });
  throw new Error("CRASH_TEST_INVARIANT_FAILED");
}
main().catch(() => {
  // No SQL, DSN, tenant identifiers, or errors to stdout/stderr.
  process.send?.({ phase: "FAULT_CHILD_ERROR" });
  process.exitCode = 2;
}).finally(async () => {
  await client.end().catch(() => undefined);
});
