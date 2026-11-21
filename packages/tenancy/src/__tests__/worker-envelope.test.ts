import { describe, expect, it } from "vitest";
import {
  createWorkerEnvelope,
  verifyWorkerEnvelope,
  WorkerEnvelopeError,
  type WorkerEnvelopeInput,
} from "../worker-envelope";

const SECRET = "installation-a-signing-key";
const input: WorkerEnvelopeInput = {
  applicationId: "crm-app",
  installationId: "install-a",
  tenantId: "tenant-a",
  principalId: "principal-1",
  jobType: "deal.approve",
  schemaRevision: "rev-1",
  nonce: "nonce-1",
  issuedAt: 1000,
  payload: { dealId: "deal-1" },
};
const context = {
  secret: SECRET,
  expectedApplicationId: "crm-app",
  expectedInstallationId: "install-a",
  now: 1100,
};

function expectCode(envelope: unknown, code: string, overrides = {}) {
  let captured: unknown;
  try {
    verifyWorkerEnvelope(envelope as never, { ...context, ...overrides });
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(WorkerEnvelopeError);
  expect((captured as WorkerEnvelopeError).code).toBe(code);
}

describe("M02-E14 installation-bound worker envelopes", () => {
  it("accepts a signed envelope with matching binding", () => {
    const envelope = createWorkerEnvelope(input, SECRET);
    expect(verifyWorkerEnvelope(envelope, context)).toBe(envelope);
  });

  it("rejects wrong installation and wrong application", () => {
    const envelope = createWorkerEnvelope(input, SECRET);
    expectCode(envelope, "INSTALLATION_MISMATCH", { expectedInstallationId: "install-b" });
    expectCode(envelope, "INSTALLATION_MISMATCH", { expectedApplicationId: "other-app" });
  });

  it("rejects forged signatures and retired secrets", () => {
    const envelope = createWorkerEnvelope(input, SECRET);
    expectCode(envelope, "INVALID_SIGNATURE", { secret: "different-key" });
    const tampered = { ...envelope, payload: { dealId: "deal-2" } };
    expectCode(tampered, "INVALID_SIGNATURE");
  });

  it("rejects stale, future and replayed work", () => {
    const envelope = createWorkerEnvelope(input, SECRET);
    expectCode(envelope, "STALE_ENVELOPE", { now: 2000 });
    expectCode(envelope, "STALE_ENVELOPE", { now: 900 });
    expectCode(envelope, "REPLAY", { seenNonces: new Set(["nonce-1"]) });
  });

  it("rejects revoked principals", () => {
    const envelope = createWorkerEnvelope(input, SECRET);
    expectCode(envelope, "PRINCIPAL_REVOKED", {
      revokedPrincipalIds: new Set(["principal-1"]),
    });
  });

  it("refuses replay across installations with a different signing key", () => {
    const envelope = createWorkerEnvelope(input, "installation-b-key");
    expectCode(envelope, "INVALID_SIGNATURE", { secret: SECRET });
  });
});
