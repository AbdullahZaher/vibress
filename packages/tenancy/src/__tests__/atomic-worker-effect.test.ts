import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asPrincipalId,
  asTenantId,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import { runAtomicWorkerSqlEffect } from "../atomic-worker-effect";
import {
  createWorkerEnvelope,
  workerOperationDigest,
  WorkerEnvelopeError,
  type WorkerEnvelope,
  type WorkerEnvelopeInput,
} from "../worker-envelope";
import { verifyTenantScope, type MembershipRecord, type VerifiedScope } from "../scope";
import type {
  QueryResult,
  ScopedTransaction,
  TenantUnitOfWorkRunner,
} from "../unit-of-work";

const SECRET = "disposable-installation-a-signing-key";
const fixedTime = 1100;

function envelopeFor(
  changes: Partial<WorkerEnvelopeInput> = {},
  secret = SECRET,
): WorkerEnvelope {
  return createWorkerEnvelope(
    {
      installationId: "install-a",
      applicationId: "crm-app",
      tenantId: "tenant-a",
      principalId: "principal-1",
      jobType: "deal.approve",
      schemaRevision: "rev-1",
      nonce: "operation-1",
      issuedAt: 1000,
      payload: { dealId: "deal-1", amount: 5 },
      ...changes,
    },
    secret,
  );
}

function scopeFor(application = "crm-app", tenant = "tenant-a"): VerifiedScope {
  const applicationId = asApplicationId(application);
  const tenantId = asTenantId(tenant);
  const principalId = asPrincipalId("principal-1");
  const permissions = ["jobs.apply"];
  const principal: VerifiedPrincipal = {
    id: principalId,
    kind: "staff",
    applicationId,
    tenantIds: [tenantId],
    roles: ["worker"],
    permissions,
  };
  const membership: MembershipRecord = {
    applicationId,
    tenantId,
    principalId,
    active: true,
    roles: ["worker"],
    permissions,
  };
  return verifyTenantScope({
    applicationId,
    tenantId,
    principal,
    membership,
    authorization: { allowed: true, permissions, policyVersion: "p1" },
  });
}

interface Receipt {
  readonly principal_id: string;
  readonly job_type: string;
  readonly schema_revision: string;
  readonly payload_digest: string;
}

/**
 * A deterministic transaction mock for helper-level tests only. It models
 * commit/rollback, not PostgreSQL unique-index locking, RLS, or true races.
 * Real multi-process proofs remain a separate mandatory acceptance gate.
 */
class ReceiptTransactionFixture implements TenantUnitOfWorkRunner {
  readonly receipts = new Map<string, Receipt>();
  readonly effects: string[] = [];
  unknownCommitOnce = false;
  failSqlEffectOnce = false;
  authorityAllowed = true;
  authorityChecks = 0;

  async run<T>(
    scope: VerifiedScope,
    work: (tx: ScopedTransaction) => Promise<T>,
  ): Promise<T> {
    const pendingReceipts = new Map<string, Receipt>();
    const pendingEffects: string[] = [];
    const tx: ScopedTransaction = {
      scope,
      markRollbackOnly(reason: string): void {
        throw new Error(reason);
      },
      query: async <TRow = unknown>(
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<QueryResult<TRow>> => {
        const key = JSON.stringify(parameters.slice(0, 4));
        let rows: unknown[];
        if (sql.startsWith("INSERT INTO platform_worker_effect_receipts")) {
          if (this.receipts.has(key) || pendingReceipts.has(key)) {
            rows = [];
          } else {
            const receipt: Receipt = {
              principal_id: String(parameters[4]),
              job_type: String(parameters[5]),
              schema_revision: String(parameters[6]),
              payload_digest: String(parameters[7]),
            };
            pendingReceipts.set(key, receipt);
            rows = [{ payload_digest: receipt.payload_digest }];
          }
        } else if (sql.startsWith("SELECT principal_id, job_type")) {
          const receipt = this.receipts.get(key);
          rows = receipt ? [receipt] : [];
        } else if (sql === "INSERT INTO test_protected_effects") {
          if (this.failSqlEffectOnce) {
            this.failSqlEffectOnce = false;
            throw new Error("disposable SQL effect failed");
          }
          pendingEffects.push(String(parameters[0]));
          rows = [];
        } else {
          throw new Error("unexpected fixture SQL");
        }
        return { rows: rows as TRow[], rowCount: rows.length };
      },
    };
    const result = await work(tx);
    for (const [key, receipt] of pendingReceipts) {
      this.receipts.set(key, receipt);
    }
    this.effects.push(...pendingEffects);
    if (this.unknownCommitOnce) {
      this.unknownCommitOnce = false;
      throw new Error("connection lost during COMMIT; outcome unknown");
    }
    return result;
  }
}

async function execute(
  fixture: ReceiptTransactionFixture,
  envelope = envelopeFor(),
  scope = scopeFor(),
  trustedInstallationId = "install-a",
) {
  return runAtomicWorkerSqlEffect({
    envelope,
    scope,
    verification: {
      secret: SECRET,
      expectedInstallationId: trustedInstallationId,
      expectedApplicationId: scope.applicationId,
      now: fixedTime,
    },
    unitOfWork: fixture,
    assertCurrentAuthority: async () => {
      fixture.authorityChecks++;
      if (!fixture.authorityAllowed) throw new Error("membership revoked");
    },
    sqlEffect: async (tx, verified) => {
      await tx.query("INSERT INTO test_protected_effects", [verified.nonce]);
    },
  });
}

describe("M02 opt-in atomic SQL Worker effect contract (mock transaction)", () => {
  it("applies once and returns durable completion on delivery replay", async () => {
    const fixture = new ReceiptTransactionFixture();
    expect((await execute(fixture)).status).toBe("applied");
    expect((await execute(fixture)).status).toBe("already_committed");
    expect(fixture.effects).toEqual(["operation-1"]);
    expect(fixture.receipts.size).toBe(1);
    expect(fixture.authorityChecks).toBe(2);
  });

  it("rejects a different authenticated payload using the same scoped nonce", async () => {
    const fixture = new ReceiptTransactionFixture();
    await execute(fixture);
    await expect(execute(fixture, envelopeFor({
      payload: { dealId: "deal-2", amount: 5 },
    }))).rejects.toMatchObject({
      code: "IDENTITY_CONFLICT",
    });
    expect(fixture.effects).toHaveLength(1);
  });

  it("binds the nonce independently to installation, application, and tenant", async () => {
    const fixture = new ReceiptTransactionFixture();
    await execute(fixture);
    await execute(fixture, envelopeFor({ installationId: "install-b" }), scopeFor(), "install-b");
    await execute(fixture, envelopeFor({ tenantId: "tenant-b" }), scopeFor("crm-app", "tenant-b"));
    await execute(fixture, envelopeFor({ applicationId: "crm-two" }), scopeFor("crm-two", "tenant-a"));
    expect(fixture.receipts.size).toBe(4);
    expect(fixture.effects).toHaveLength(4);
  });

  it("fails closed for forged envelopes or a mismatched verified scope", async () => {
    const fixture = new ReceiptTransactionFixture();
    const original = envelopeFor();
    await expect(
      execute(fixture, { ...original, payload: { dealId: "tampered" } }),
    ).rejects.toBeInstanceOf(WorkerEnvelopeError);
    await expect(
      execute(fixture, original, scopeFor("crm-app", "tenant-b")),
    ).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
    await expect(
      execute(fixture, envelopeFor({ installationId: "install-b" })),
    ).rejects.toMatchObject({ code: "INSTALLATION_MISMATCH" });
    expect(fixture.effects).toHaveLength(0);
  });

  it("does not persist a claim when authoritative membership is denied", async () => {
    const fixture = new ReceiptTransactionFixture();
    fixture.authorityAllowed = false;
    await expect(execute(fixture)).rejects.toThrow("membership revoked");
    expect(fixture.receipts.size).toBe(0);
    fixture.authorityAllowed = true;
    expect((await execute(fixture)).status).toBe("applied");
  });

  it("rolls back the receipt when the protected SQL effect fails", async () => {
    const fixture = new ReceiptTransactionFixture();
    fixture.failSqlEffectOnce = true;
    await expect(execute(fixture)).rejects.toThrow("disposable SQL effect failed");
    expect(fixture.receipts.size).toBe(0);
    expect(fixture.effects).toHaveLength(0);
    expect((await execute(fixture)).status).toBe("applied");
    expect(fixture.effects).toHaveLength(1);
  });

  it("reconciles a simulated unknown COMMIT by replaying the same identity", async () => {
    const fixture = new ReceiptTransactionFixture();
    fixture.unknownCommitOnce = true;
    await expect(execute(fixture)).rejects.toThrow("outcome unknown");
    expect((await execute(fixture)).status).toBe("already_committed");
    expect(fixture.effects).toHaveLength(1);
  });

  it("binds digest independently of JSON key insertion order", () => {
    expect(
      workerOperationDigest(envelopeFor({ payload: { amount: 5, dealId: "deal-1" } })),
    ).toEqual(workerOperationDigest(envelopeFor()));
  });
});
