// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  inspectConsumerSource,
  publicationStatus,
  runExternalConsumerProof,
  validateProof,
} from "../platform/dx/external-consumer-proof.mjs";
import { repoRootFromModule } from "../platform/inventory/repository-inventory.mjs";

const repoRoot = repoRootFromModule();

describe("clean external consumer proof (M01-E09)", () => {
  it("imports only the public kernel entry", () => {
    const consumer = inspectConsumerSource(repoRoot);
    expect(consumer.specifiers).toEqual(["@vibress/platform-kernel"]);
    expect(consumer.forbiddenImports).toEqual([]);
  });

  it("declares a custom action and a custom route", () => {
    const consumer = inspectConsumerSource(repoRoot);
    expect(consumer.customActions).toContain("approveDeal");
    expect(consumer.routes).toContain("/crm/deals/:dealId/approve");
  });

  it("records that public publication is not authorized", () => {
    const publication = publicationStatus(repoRoot);
    expect(publication.privatePackage).toBe(true);
    expect(publication.publishable).toBe(false);
    expect(publication.reason).toMatch(/A2\/G6/);
  });

  it("rejects forged proof results", () => {
    const good = {
      consumer: { forbiddenImports: [], specifiers: ["@vibress/platform-kernel"], customActions: ["a"], routes: ["/a"] },
      pack: { entryPresent: true },
      typecheck: { exitCode: 0 },
      runtime: { hostingEnabled: false },
    };
    expect(validateProof(good)).toEqual([]);
    expect(validateProof({ ...good, consumer: { ...good.consumer, forbiddenImports: ["../../packages/database"] } })).toEqual(
      expect.arrayContaining([expect.stringContaining("forbidden imports")]),
    );
    expect(validateProof({ ...good, typecheck: { exitCode: 1 } })).toContain("external consumer typecheck failed");
    expect(validateProof({ ...good, runtime: { hostingEnabled: true } })).toContain(
      "unsupported production application hosting must remain disabled",
    );
  });

  it("passes the real offline packed-contract proof", () => {
    const proof = runExternalConsumerProof(repoRoot);
    expect(proof.errors).toEqual([]);
    expect(proof.typecheck.exitCode).toBe(0);
    expect(proof.pack.entryPresent).toBe(true);
    expect(proof.runtime.databaseTouched).toBe(false);
  }, 60000);
});
