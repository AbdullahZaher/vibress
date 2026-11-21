import { assertVerifiedScope, type VerifiedScope } from "./scope";
import {
  verifyWorkerEnvelope,
  workerOperationDigest,
  WorkerEnvelopeError,
  type WorkerEnvelope,
  type WorkerVerificationContext,
} from "./worker-envelope";
import type { ScopedTransaction, TenantUnitOfWorkRunner } from "./unit-of-work";

/**
 * M02: one committed SQL effect per installation/application/tenant/nonce.
 *
 * The unique index and the protected SQL effect MUST share the same PostgreSQL
 * transaction. A BullMQ acknowledgment is safe only after this call resolves.
 * Do not perform S3, HTTP, email, or other external effects inside sqlEffect:
 * PostgreSQL cannot commit them atomically.
 *
 * This is an opt-in primitive, not a replacement for the CMS publication jobs
 * or a claim that the existing Worker is wired to this contract.
 */
export interface AtomicWorkerSqlEffectOptions {
  readonly envelope: WorkerEnvelope;
  readonly verification: Omit<WorkerVerificationContext, "seenNonces">;
  readonly scope: VerifiedScope;
  readonly unitOfWork: TenantUnitOfWorkRunner;
  /**
   * Recheck current authority inside the SAME scoped PostgreSQL transaction.
   * The implementation must share a database lock/epoch fence with revocation.
   * An ordinary pre-transaction cache check does not satisfy this contract.
   */
  readonly assertCurrentAuthority: (
    transaction: ScopedTransaction,
    envelope: WorkerEnvelope,
  ) => Promise<void>;
  /** SQL-only protected effect; use the supplied transaction for every query. */
  readonly sqlEffect: (
    transaction: ScopedTransaction,
    envelope: WorkerEnvelope,
  ) => Promise<void>;
}

export type AtomicWorkerEffectOutcome =
  | { readonly status: "applied"; readonly operationDigest: string }
  | { readonly status: "already_committed"; readonly operationDigest: string };

export class AtomicWorkerEffectError extends Error {
  readonly code: "IDENTITY_CONFLICT" | "RECEIPT_UNAVAILABLE" | "INVALID_EFFECT";
  constructor(code: AtomicWorkerEffectError["code"], message: string) {
    super(message);
    this.name = "AtomicWorkerEffectError";
    this.code = code;
  }
}

interface ReceiptRow {
  readonly principal_id: string;
  readonly job_type: string;
  readonly schema_revision: string;
  readonly payload_digest: string;
}

// The INSERT takes PostgreSQL's unique-index lock. A concurrent conflict
// waits for the first transaction's outcome. If the first rolls back, exactly
// one contender may insert and execute; if it commits, others skip the effect.
// The receipt is inserted before sqlEffect but is NOT visible until the entire
// transaction commits. Thus a crash between the INSERT and effect does not
// persist a consumed nonce or lose acknowledged work.
const CLAIM_SQL = [
  "INSERT INTO platform_worker_effect_receipts",
  "  (installation_id, application_id, tenant_id, nonce,",
  "   principal_id, job_type, schema_revision, payload_digest)",
  "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
  "ON CONFLICT (installation_id, application_id, tenant_id, nonce)",
  "DO NOTHING",
  "RETURNING payload_digest",
].join("\n");

const RECEIPT_SQL = [
  "SELECT principal_id, job_type, schema_revision, payload_digest",
  "FROM platform_worker_effect_receipts",
  "WHERE installation_id = $1 AND application_id = $2",
  "  AND tenant_id = $3 AND nonce = $4",
].join("\n");

export async function runAtomicWorkerSqlEffect(
  options: AtomicWorkerSqlEffectOptions,
): Promise<AtomicWorkerEffectOutcome> {
  // A local Set or file-backed nonce cache is never an atomic replay guard.
  const envelope = verifyWorkerEnvelope(options.envelope, {
    secret: options.verification.secret,
    expectedApplicationId: options.verification.expectedApplicationId,
    expectedInstallationId: options.verification.expectedInstallationId,
    now: options.verification.now,
    ...(options.verification.maxAgeSeconds === undefined
      ? {}
      : { maxAgeSeconds: options.verification.maxAgeSeconds }),
    ...(options.verification.revokedPrincipalIds === undefined
      ? {}
      : { revokedPrincipalIds: options.verification.revokedPrincipalIds }),
  });
  assertVerifiedScope(options.scope);
  if (
    envelope.applicationId !== options.scope.applicationId ||
    envelope.tenantId !== options.scope.tenantId ||
    envelope.principalId !== options.scope.principal.id
  ) {
    throw new WorkerEnvelopeError(
      "SCOPE_MISMATCH",
      "worker identity does not match the server-verified scope",
    );
  }
  if (
    typeof options.assertCurrentAuthority !== "function" ||
    typeof options.sqlEffect !== "function"
  ) {
    throw new AtomicWorkerEffectError(
      "INVALID_EFFECT",
      "a transactional authority fence and SQL effect are required",
    );
  }
  if (Buffer.byteLength(envelope.nonce, "utf8") > 256) {
    throw new WorkerEnvelopeError("INVALID_NONCE", "nonce exceeds 256 bytes");
  }

  const digest = workerOperationDigest(envelope);
  const identity = [
    envelope.installationId,
    envelope.applicationId,
    envelope.tenantId,
    envelope.nonce,
  ] as const;

  // Do NOT retry an unknown COMMIT outcome inside this callback. Let the
  // Worker retry the SAME immutable operation ID and reconcile via this
  // durable receipt. The Unit of Work destroys ambiguous connections.
  return options.unitOfWork.run(options.scope, async (transaction) => {
    await options.assertCurrentAuthority(transaction, envelope);
    if (workerOperationDigest(envelope) !== digest) {
      throw new AtomicWorkerEffectError(
        "IDENTITY_CONFLICT",
        "authenticated operation changed during authorization",
      );
    }

    const claimed = await transaction.query<{ payload_digest: string }>(
      CLAIM_SQL,
      [
        ...identity,
        envelope.principalId,
        envelope.jobType,
        envelope.schemaRevision,
        digest,
      ],
    );
    if (claimed.rows.length === 1) {
      if (claimed.rows[0]?.payload_digest !== digest) {
        throw new AtomicWorkerEffectError(
          "IDENTITY_CONFLICT",
          "inserted receipt has an unexpected digest",
        );
      }
      await options.sqlEffect(transaction, envelope);
      // The same authenticated payload must survive all awaited callbacks.
      // If trusted code mutated it, roll back BOTH the effect and receipt.
      if (workerOperationDigest(envelope) !== digest) {
        throw new AtomicWorkerEffectError(
          "IDENTITY_CONFLICT",
          "authenticated operation changed during SQL effect",
        );
      }
      return { status: "applied" as const, operationDigest: digest };
    }
    if (claimed.rows.length !== 0) {
      throw new AtomicWorkerEffectError(
        "RECEIPT_UNAVAILABLE",
        "unexpected receipt insertion result",
      );
    }

    const existing = await transaction.query<ReceiptRow>(
      RECEIPT_SQL,
      identity,
    );
    const row = existing.rows[0];
    if (!row || existing.rows.length !== 1) {
      throw new AtomicWorkerEffectError(
        "RECEIPT_UNAVAILABLE",
        "conflicting receipt is not visible in the verified scope",
      );
    }
    if (
      row.payload_digest !== digest ||
      row.principal_id !== envelope.principalId ||
      row.job_type !== envelope.jobType ||
      row.schema_revision !== envelope.schemaRevision
    ) {
      throw new AtomicWorkerEffectError(
        "IDENTITY_CONFLICT",
        "operation identity was reused with different authenticated claims",
      );
    }
    return { status: "already_committed" as const, operationDigest: digest };
  });
}
