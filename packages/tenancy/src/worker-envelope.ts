import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * M02-E14 — installation-bound, replay-resistant Worker job envelope.
 * Deterministic and adapter-agnostic: BullMQ/Redis transport is intentionally
 * outside this contract. Signing keys are installation-scoped test secrets.
 */
export interface WorkerEnvelopeInput {
  readonly applicationId: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly jobType: string;
  readonly schemaRevision: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly payload: unknown;
}

export interface WorkerEnvelope {
  readonly version: 1;
  readonly applicationId: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly jobType: string;
  readonly schemaRevision: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly payload: unknown;
  readonly signature: string;
}

export class WorkerEnvelopeError extends Error {
  readonly code: string;
  constructor(code: string, reason: string) {
    super(reason);
    this.name = "WorkerEnvelopeError";
    this.code = code;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function createWorkerEnvelope(
  input: WorkerEnvelopeInput,
  secret: string,
): WorkerEnvelope {
  if (!input.nonce || input.nonce.trim() === "") {
    throw new WorkerEnvelopeError("INVALID_NONCE", "nonce is required");
  }
  const body = canonical({ version: 1 as const, ...input });
  return Object.freeze({ version: 1 as const, ...input, signature: sign(body, secret) });
}

export interface WorkerVerificationContext {
  readonly secret: string;
  readonly expectedApplicationId: string;
  readonly expectedInstallationId: string;
  readonly now: number;
  readonly maxAgeSeconds?: number;
  readonly seenNonces?: ReadonlySet<string>;
  readonly revokedPrincipalIds?: ReadonlySet<string>;
}

export function verifyWorkerEnvelope(
  envelope: WorkerEnvelope,
  context: WorkerVerificationContext,
): WorkerEnvelope {
  if (envelope.version !== 1) {
    throw new WorkerEnvelopeError("UNSUPPORTED_VERSION", "unsupported envelope version");
  }
  if (
    envelope.applicationId !== context.expectedApplicationId ||
    envelope.installationId !== context.expectedInstallationId
  ) {
    throw new WorkerEnvelopeError(
      "INSTALLATION_MISMATCH",
      "envelope does not belong to the receiving application/installation",
    );
  }
  if (context.revokedPrincipalIds?.has(envelope.principalId)) {
    throw new WorkerEnvelopeError("PRINCIPAL_REVOKED", "principal was revoked");
  }
  const maxAge = context.maxAgeSeconds ?? 300;
  if (context.now - envelope.issuedAt > maxAge || envelope.issuedAt > context.now + 30) {
    throw new WorkerEnvelopeError("STALE_ENVELOPE", "envelope is outside its acceptance window");
  }
  if (context.seenNonces?.has(envelope.nonce)) {
    throw new WorkerEnvelopeError("REPLAY", "envelope nonce was already consumed");
  }
  const { signature, ...claims } = envelope;
  const expected = sign(canonical(claims), context.secret);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new WorkerEnvelopeError("INVALID_SIGNATURE", "envelope signature is invalid");
  }
  return envelope;
}


/** Stable digest for the immutable authenticated SQL operation, independent
 * of JSON object insertion order. The scope and nonce are stored separately
 * in the receipt's unique identity. */
export function workerOperationDigest(
  envelope: Pick<WorkerEnvelope, "jobType" | "schemaRevision" | "payload">,
): string {
  return createHash("sha256")
    .update(canonical({
      jobType: envelope.jobType,
      schemaRevision: envelope.schemaRevision,
      payload: envelope.payload,
    }))
    .digest("hex");
}
