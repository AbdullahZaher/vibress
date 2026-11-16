import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import { verifyTenantScope, type MembershipRecord, type VerifiedScope } from "../scope";
import {
  TenantAsyncEscapeError,
  TenantRoleSwitchError,
  TenantScopeMutationError,
  TenantScopeSwitchError,
  TenantTransactionRollbackOnlyError,
  TenantUnitOfWork,
  type PoolClientLike,
  type QueryResult,
} from "../unit-of-work";

const applicationId = asApplicationId("customer-crm");
const tenantA = asTenantId("tenant-a");
const tenantB = asTenantId("tenant-b");
const principalId = asPrincipalId("principal-1");

const permissions = ["customers.read", "customers.write"];

function scopeFor(tenantId = tenantA, policyVersion = "p1"): VerifiedScope {
  const principal: VerifiedPrincipal = {
    id: principalId,
    kind: "staff",
    applicationId,
    tenantIds: [tenantA, tenantB],
    roles: ["sales"],
    permissions,
  };
  const membership: MembershipRecord = {
    applicationId,
    tenantId,
    principalId,
    active: true,
    roles: ["sales"],
    permissions,
  };
  return verifyTenantScope({
    applicationId,
    tenantId,
    principal,
    membership,
    authorization: { allowed: true, permissions, policyVersion },
  });
}

class FakeClient implements PoolClientLike {
  readonly statements: string[] = [];
  released = false;
  destroyed = false;
  probeFails = false;
  commitFails = false;
  rollbackFails = false;
  currentUser = "vibress_platform_runtime";
  sessionUser = "vibress_platform_runtime";
  heldQuery: Promise<void> | null = null;
  private readonly settings: Record<string, string | null> = {
    "vibress.application_id": null,
    "vibress.tenant_id": null,
    "vibress.principal_id": null,
  };

  async query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    this.statements.push(sql.trim().split("\n")[0]!.trim());
    if (sql.includes("set_config(")) {
      this.settings["vibress.application_id"] = String(parameters?.[0] ?? "");
      this.settings["vibress.tenant_id"] = String(parameters?.[1] ?? "");
      this.settings["vibress.principal_id"] = String(parameters?.[2] ?? "");
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("current_setting(")) {
      return {
        rows: [
          {
            application_id: this.settings["vibress.application_id"],
            tenant_id: this.settings["vibress.tenant_id"],
            principal_id: this.settings["vibress.principal_id"],
            current_user: this.currentUser,
            session_user: this.sessionUser,
          } as TRow,
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("current_user AS current_user")) {
      if (this.probeFails) {
        throw new Error("current transaction is aborted");
      }
      return {
        rows: [
          {
            current_user: this.currentUser,
            session_user: this.sessionUser,
          } as TRow,
        ],
        rowCount: 1,
      };
    }
    if (sql.trim() === "HOLD") {
      await this.heldQuery;
      return { rows: [], rowCount: 0 };
    }
    if (sql.trim() === "ROLLBACK" && this.rollbackFails) {
      throw new Error("connection lost during rollback");
    }
    if (sql.trim() === "COMMIT") {
      if (this.commitFails) {
        throw new Error("connection lost during commit");
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  release(destroy = false): void {
    this.released = true;
    this.destroyed = destroy;
  }
}

class FakePool {
  readonly client = new FakeClient();
  connections = 0;

  async connect(): Promise<PoolClientLike> {
    this.connections += 1;
    return this.client;
  }
}

describe("TenantUnitOfWork", () => {
  it("sets transaction-local context on the exact connection and commits", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    const scope = scopeFor();

    const result = await uow.run(scope, async (tx) => {
      expect(tx.scope).toBe(scope);
      await tx.query("SELECT * FROM platform_crm_customers");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(pool.client.statements).toEqual([
      "BEGIN",
      "SELECT",
      "SELECT",
      "SELECT * FROM platform_crm_customers",
      "SELECT",
      "COMMIT",
    ]);
    expect(pool.client.released).toBe(true);
    expect(pool.client.destroyed).toBe(false);
  });

  it("reuses the parent transaction for an identical nested scope", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    const scope = scopeFor();

    await uow.run(scope, async (tx) => {
      await tx.query("SELECT 1");
      await uow.run(scope, async (nested) => {
        expect(nested.scope).toBe(scope);
        await nested.query("SELECT 2");
      });
    });

    expect(pool.connections).toBe(1);
    expect(pool.client.statements.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(pool.client.statements.filter((s) => s === "COMMIT")).toHaveLength(1);
  });

  it("rejects a nested tenant switch and keeps the outer transaction rollback-only", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);

    await expect(
      uow.run(scopeFor(), async (tx) => {
        await tx.query("SELECT 1");
        await uow.run(scopeFor(tenantB), async () => undefined);
      }),
    ).rejects.toThrow(TenantScopeSwitchError);

    expect(pool.client.statements).toContain("ROLLBACK");
    expect(pool.client.statements).not.toContain("COMMIT");
  });

  it("cannot commit when a caught nested failure occurred", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    const scope = scopeFor();

    await expect(
      uow.run(scope, async (tx) => {
        try {
          await uow.run(scope, async () => {
            throw new Error("inner action failed");
          });
        } catch {
          // Swallowing the error must not allow a partial commit.
        }
        await tx.query("SELECT 1");
      }),
    ).rejects.toThrow(TenantTransactionRollbackOnlyError);

    expect(pool.client.statements).toContain("ROLLBACK");
    expect(pool.client.statements).not.toContain("COMMIT");
  });

  it("detects an aborted transaction when the callback swallows the SQL error", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    pool.client.probeFails = true;

    await expect(
      uow.run(scopeFor(), async (tx) => {
        try {
          await tx.query("INSERT INTO platform_crm_customers VALUES ('x')");
        } catch {
          // Simulates a swallowed PostgreSQL error.
        }
      }),
    ).rejects.toThrow(TenantTransactionRollbackOnlyError);

    expect(pool.client.statements).toContain("ROLLBACK");
    expect(pool.client.statements).not.toContain("COMMIT");
  });

  it("rejects scoped attempts to mutate the database tenant context", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);

    await expect(
      uow.run(scopeFor(), async (tx) => {
        await tx.query("SELECT set_config('vibress.tenant_id', 'tenant-b', true)");
      }),
    ).rejects.toThrow(TenantScopeMutationError);

    expect(pool.client.statements).toContain("ROLLBACK");
  });

  it("detects schema-qualified and comment-obfuscated scope mutations and marks rollback-only", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);

    await expect(
      uow.run(scopeFor(), async (tx) => {
        await tx.query(
          "SELECT /* comment */ pg_catalog.set_config('vibress.tenant_id', 'tenant-b', true)",
        );
      }),
    ).rejects.toThrow(TenantScopeMutationError);

    expect(pool.client.statements).toContain("ROLLBACK");

    // Also assert that if an attacker catches TenantScopeMutationError, commit is denied
    await expect(
      uow.run(scopeFor(), async (tx) => {
        try {
          await tx.query(
            "SET LOCAL /* evasion */ \"vibress.tenant_id\" = 'malicious'",
          );
        } catch {
          // Swallowed attempt
        }
      }),
    ).rejects.toThrow(TenantTransactionRollbackOnlyError);

    expect(pool.client.statements).toContain("ROLLBACK");
  });

  it("always releases the connection", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    await expect(
      uow.run(scopeFor(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(pool.client.released).toBe(true);
    expect(pool.client.destroyed).toBe(false);
    expect(pool.client.statements).toContain("ROLLBACK");
  });

  it("rejects statements that switch or reset the database role", async () => {
    const attempts = [
      "SET ROLE platform_admin",
      "SET LOCAL ROLE platform_admin",
      "SET SESSION AUTHORIZATION platform_admin",
      "RESET ROLE",
      "RESET SESSION AUTHORIZATION",
      "SELECT set_config('role', 'platform_admin', false)",
      "SELECT pg_catalog.set_config('session_authorization', 'platform_admin', false)",
      "SET LOCAL /* evasion */ ROLE platform_admin",
    ];

    for (const sql of attempts) {
      const pool = new FakePool();
      const uow = new TenantUnitOfWork(pool);
      await expect(
        uow.run(scopeFor(), async (tx) => {
          await tx.query(sql);
        }),
      ).rejects.toThrow(TenantRoleSwitchError);
      expect(pool.client.statements).toContain("ROLLBACK");
      expect(pool.client.statements).not.toContain("COMMIT");
    }
  });

  it("detects a role change that evaded SQL inspection and destroys the connection", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);

    await expect(
      uow.run(scopeFor(), async (tx) => {
        pool.client.currentUser = "platform_admin";
        await tx.query("SELECT 1");
      }),
    ).rejects.toThrow(TenantRoleSwitchError);

    expect(pool.client.statements).toContain("ROLLBACK");
    expect(pool.client.statements).not.toContain("COMMIT");
    // Role changes survive ROLLBACK, so the connection must not be pooled.
    expect(pool.client.destroyed).toBe(true);
  });

  it("fails closed when unawaited work is still in flight at settlement", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    let releaseHold!: () => void;
    pool.client.heldQuery = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    let escaped: Promise<unknown> | undefined;
    await expect(
      uow.run(scopeFor(), async (tx) => {
        escaped = tx.query("HOLD");
      }),
    ).rejects.toThrow(TenantAsyncEscapeError);

    expect(pool.client.statements).not.toContain("ROLLBACK");
    expect(pool.client.statements).not.toContain("COMMIT");
    expect(pool.client.released).toBe(true);
    expect(pool.client.destroyed).toBe(true);

    releaseHold();
    await escaped;
  });

  it("rejects scoped queries after the unit of work settled", async () => {
    const pool = new FakePool();
    const uow = new TenantUnitOfWork(pool);
    let late!: () => Promise<unknown>;

    await uow.run(scopeFor(), async (tx) => {
      late = () => tx.query("SELECT 1");
    });

    await expect(late()).rejects.toThrow(TenantAsyncEscapeError);
    expect(pool.client.statements.filter((s) => s === "SELECT 1")).toHaveLength(
      0,
    );
    expect(pool.client.destroyed).toBe(false);
  });

  it("destroys the connection when ROLLBACK fails", async () => {
    const pool = new FakePool();
    pool.client.rollbackFails = true;
    const uow = new TenantUnitOfWork(pool);

    await expect(
      uow.run(scopeFor(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(pool.client.released).toBe(true);
    expect(pool.client.destroyed).toBe(true);
  });

  it("destroys the connection when COMMIT fails", async () => {
    const pool = new FakePool();
    pool.client.commitFails = true;
    const uow = new TenantUnitOfWork(pool);

    await expect(uow.run(scopeFor(), async () => "ok")).rejects.toThrow(
      "connection lost during commit",
    );

    expect(pool.client.released).toBe(true);
    expect(pool.client.destroyed).toBe(true);
  });
});
