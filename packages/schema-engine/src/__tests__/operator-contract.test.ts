import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { compileResourceSchema, type SchemaCompilationScope } from "../schema";
import { createSchemaManifest, planSchemaChanges } from "../planning";
import {
  rehydrateSchemaChangePlan,
  renderAdditiveColumn,
  renderTrustedAdditiveColumn,
  SchemaExecutionContractError,
} from "../operator-contract";

const scope: SchemaCompilationScope = {
  applicationId: asApplicationId("operator-crm"),
  installationId: asInstallationId("operator-local"),
};

function example() {
  const before = compileResourceSchema([{
    ...scope, id: "catalog", ownership: "application" as const,
    fields: [{ id: "name", type: "text" as const, required: true }],
  }], scope);
  const current = createSchemaManifest(before);
  const proposed = compileResourceSchema([{
    ...scope, id: "catalog", ownership: "application" as const,
    fields: [
      { id: "name", type: "text" as const, required: true },
      { id: "website", type: "text" as const, required: false },
    ],
  }], scope);
  const plan = planSchemaChanges(current, proposed, {
    scope, expectedCurrentDigest: current.digest,
  });
  return { current, plan, proposed };
}

describe("M03-S03 trusted plan reconstruction and SQL boundary", () => {
  it("reconstructs a canonical persisted plan and deterministic one-column SQL", () => {
    const { current, plan } = example();
    const persisted: unknown = JSON.parse(JSON.stringify(plan));
    const rebuilt = rehydrateSchemaChangePlan(persisted, current, scope);
    expect(rebuilt).toEqual(plan);
    const ddl = renderAdditiveColumn(rebuilt, current);
    expect(ddl.operationId).toBe(plan.operations[0]?.id);
    expect(ddl.planDigest).toBe(plan.digest);
    expect(ddl.sql).toMatch(/^ALTER TABLE "public"\."vr_catalog_[0-9a-f]{12}" ADD COLUMN "website" text$/);
    expect(renderTrustedAdditiveColumn(persisted, current, scope).ddl).toEqual(ddl);
    expect(ddl.sql).not.toMatch(/;|DROP|CREATE|DEFAULT|IF NOT EXISTS/);
  });

  it("rejects fabricated operation status, ID, text and plan digest", () => {
    const { current, plan } = example();
    for (const patch of [
      { operations: plan.operations.map(o => ({ ...o, status: "DENIED" })) },
      { operations: plan.operations.map(o => ({ ...o, id: "op_forged" })) },
      { operations: plan.operations.map(o => ({ ...o, reason: "SQL injection" })) },
      { digest: "f".repeat(64) },
      { disposition: "NO_CHANGES" },
      { postgresVersion: 17 },
      { planVersion: 2 },
      { extra: "unknown" },
    ]) {
      expect(() => rehydrateSchemaChangePlan({ ...plan, ...patch }, current, scope))
        .toThrow();
    }
  });

  it("refuses changed expected digest and cross-installation reuse", () => {
    const { current, plan } = example();
    const otherScope: SchemaCompilationScope = {
      ...scope, installationId: asInstallationId("other-local"),
    };
    expect(() => rehydrateSchemaChangePlan(plan, current, otherScope)).toThrow();
    expect(() => rehydrateSchemaChangePlan(plan, null, scope)).toThrow();
    expect(() => rehydrateSchemaChangePlan({
      ...plan,
      preconditions: { ...plan.preconditions, expectedCurrentDigest: null },
    }, current, scope)).toThrow(SchemaExecutionContractError);
  });

  it("rejects Proxies, symbols, accessors, prototypes and sparse operations before invoking getters", () => {
    const { current, plan } = example();
    let invokes = 0;
    const handler = {
      get() { invokes++; throw Error("untrusted get trap"); },
      getPrototypeOf() { invokes++; throw Error("untrusted prototype trap"); },
      ownKeys() { invokes++; throw Error("untrusted ownKeys trap"); },
    } satisfies ProxyHandler<object>;
    expect(() => rehydrateSchemaChangePlan(new Proxy({ ...plan }, handler), current, scope))
      .toThrow(SchemaExecutionContractError);
    const malicious = { ...plan };
    Object.defineProperty(malicious, "digest", {
      enumerable: true, get() { invokes++; return plan.digest; },
    });
    expect(() => rehydrateSchemaChangePlan(malicious, current, scope))
      .toThrow(SchemaExecutionContractError);
    expect(invokes).toBe(0);
    expect(() => rehydrateSchemaChangePlan({ ...plan, [Symbol("sql")]: "DROP" }, current, scope))
      .toThrow(SchemaExecutionContractError);
    const bad = Object.create({ parent: "hidden" }) as object;
    expect(() => rehydrateSchemaChangePlan(bad, current, scope))
      .toThrow(SchemaExecutionContractError);
    const holes = new Array<unknown>(2);
    holes[0] = plan.operations[0];
    expect(() => rehydrateSchemaChangePlan({ ...plan, operations: holes }, current, scope))
      .toThrow(SchemaExecutionContractError);
  });

  it("does not render tenant-owned tables even when their optional field is PLANNED", () => {
    const tenant = compileResourceSchema([{
      ...scope, id: "customers", ownership: "tenant" as const,
      fields: [{ id: "name", type: "text" as const, required: true }],
    }], scope);
    const current = createSchemaManifest(tenant);
    const proposed = compileResourceSchema([{
      ...scope, id: "customers", ownership: "tenant" as const,
      fields: [
        { id: "name", type: "text" as const, required: true },
        { id: "notes", type: "text" as const, required: false },
      ],
    }], scope);
    const plan = planSchemaChanges(current, proposed, { scope, expectedCurrentDigest: current.digest });
    expect(plan.disposition).toBe("PLANNED");
    expect(() => renderTrustedAdditiveColumn(plan, current, scope))
      .toThrow(SchemaExecutionContractError);
  });

  it("blocks create resources, required additions, default expressions, deletions and multi-column plans", () => {
    const { current, plan } = example();
    const newResource = planSchemaChanges(null, plan.proposedManifest.canonicalIr, {
      scope, expectedCurrentDigest: null,
    });
    expect(() => renderTrustedAdditiveColumn(newResource, null, scope)).toThrow();
    for (const extra of [
      [{ id: "required_field", type: "text" as const, required: true }],
      [{ id: "with_default", type: "text" as const, required: false, default: "x" }],
      [{ id: "extra", type: "boolean" as const, required: false },
       { id: "extra_two", type: "number" as const, required: false }],
    ]) {
      const proposed = compileResourceSchema([{
        ...scope, id: "catalog", ownership: "application" as const,
        fields: [{ id: "name", type: "text" as const, required: true }, ...extra],
      }], scope);
      const candidate = planSchemaChanges(current, proposed, {
        scope, expectedCurrentDigest: current.digest,
      });
      expect(() => renderTrustedAdditiveColumn(candidate, current, scope)).toThrow();
    }
    expect(() => renderTrustedAdditiveColumn({
      ...plan,
      operations: [{ ...plan.operations[0], type: "DROP_TABLE" }],
    }, current, scope)).toThrow();
  });

  it("keeps manifests and plans byte-stable across semantically equivalent declaration order", () => {
    const { current, plan } = example();
    expect(rehydrateSchemaChangePlan(plan, current, scope).digest).toBe(plan.digest);
    const before = JSON.stringify(current);
    const after = JSON.stringify(rehydrateSchemaChangePlan(JSON.parse(JSON.stringify(plan)), current, scope));
    expect(before).toBe(JSON.stringify(createSchemaManifest(current.canonicalIr)));
    expect(after).toBe(JSON.stringify(plan));
  });
});
