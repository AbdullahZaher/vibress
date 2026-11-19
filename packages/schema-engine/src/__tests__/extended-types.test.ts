import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import {
  canonicalSchemaDigest,
  compileResourceSchema,
  parseCanonicalSchemaIR,
  ResourceSchemaError,
  serializeCanonicalSchemaIR,
  type ResourceDefinition,
} from "../schema";
import {
  createSchemaManifest,
  parseSchemaManifest,
  planSchemaChanges,
} from "../planning";
import {
  compileProvisioningContract,
  compileProvisioningTransition,
  provisioningProfileFor,
  PROVISIONING_PROFILE,
  PROVISIONING_PROFILE_V2,
} from "../physical-contract";
import { renderTrustedAdditiveColumn } from "../operator-contract";

const scope = {
  applicationId: asApplicationId("extended-types"),
  installationId: asInstallationId("installation-extended"),
};

function resource(fields: ResourceDefinition["fields"]): ResourceDefinition {
  return { ...scope, id: "invoices", ownership: "tenant", fields };
}
function manifestOf(fields: ResourceDefinition["fields"]) {
  return createSchemaManifest(compileResourceSchema([resource(fields)], scope));
}
function code(fields: ResourceDefinition["fields"]) {
  return expect(() => manifestOf(fields)).toThrow(ResourceSchemaError);
}

describe("extended exact scalar resources", () => {
  it("accepts exact integer, decimal, money, date and bounded json columns", () => {
    const manifest = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "quantity", type: "integer", required: true },
      { id: "rate", type: "decimal", precision: 12, scale: 4, required: true },
      { id: "total", type: "money", precision: 19, scale: 2, required: true },
      { id: "issued_on", type: "date", required: false },
      { id: "attributes", type: "json", maxBytes: 2048, maxDepth: 8, maxKeys: 1000, required: false },
      { id: "reference", type: "text", required: false, maxLength: 40 },
    ]);
    expect(provisioningProfileFor(manifest)).toBe(PROVISIONING_PROFILE_V2);
    const fields = new Map(manifest.resources[0]!.fields.map((f) => [f.id, f]));
    expect(fields.get("quantity")).toMatchObject({ postgresType: "integer", mappingStatus: "MAPPED" });
    expect(fields.get("rate")).toMatchObject({ postgresType: "numeric", precision: 12, scale: 4 });
    expect(fields.get("total")).toMatchObject({ postgresType: "numeric", precision: 19, scale: 2, money: true });
    expect(fields.get("issued_on")).toMatchObject({ postgresType: "date" });
    expect(fields.get("attributes")).toMatchObject({ postgresType: "jsonb", maxBytes: 2048, maxDepth: 8, maxKeys: 1000 });
    expect(fields.get("reference")).toMatchObject({ postgresType: "text", maxLength: 40 });
    const parsed = parseSchemaManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.digest).toBe(manifest.digest);
  });

  it("emits exact numeric types, money currency companion and deterministic CHECK constraints", () => {
    const manifest = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "total", type: "money", precision: 19, scale: 4, required: true },
      { id: "attributes", type: "json", maxBytes: 1024, maxDepth: 8, maxKeys: 1000, required: false },
      { id: "reference", type: "text", required: false, maxLength: 12 },
    ]);
    const physical = compileProvisioningContract(manifest, scope);
    expect(physical.profile).toBe(PROVISIONING_PROFILE_V2);
    const columns = physical.resources[0]!.columns;
    expect(columns.find((c) => c.name === "total")).toMatchObject({ type: "numeric(19,4)", required: true });
    expect(columns.find((c) => c.name === "total_currency")).toMatchObject({ type: "text", required: true });
    expect(columns.find((c) => c.name === "attributes")).toMatchObject({ type: "jsonb" });
    expect(columns.find((c) => c.name === "reference")).toMatchObject({ type: "text" });
    const checks = physical.resources[0]!.checks ?? [];
    expect(checks).toHaveLength(3);
    expect(checks.find((c) => c.columns[0] === "total_currency")).toMatchObject({
      expression: '"total_currency" ~ \'^[A-Z]{3}$\'',
      normalized: "(total_currency ~ '^[A-Z]{3}$'::text)",
    });
    expect(checks.find((c) => c.columns[0] === "attributes")?.normalized)
      .toBe("(pg_column_size(attributes) <= 1024)");
    expect(checks.find((c) => c.columns[0] === "reference")?.normalized)
      .toBe("(char_length(reference) <= 12)");
    expect(compileProvisioningContract(manifest, scope).digest).toBe(physical.digest);
  });

  it("emits generated CREATE TABLE and CHECK statements for a fresh installation", () => {
    const manifest = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "quantity", type: "integer", required: true },
      { id: "rate", type: "decimal", precision: 9, scale: 2, required: false },
      { id: "total", type: "money", precision: 19, scale: 2, required: true },
      { id: "attributes", type: "json", maxBytes: 512, maxDepth: 8, maxKeys: 1000, required: false },
    ]);
    const plan = compileProvisioningTransition(null, manifest, scope);
    const sql = plan.statements.join("\n");
    expect(sql).toContain('"quantity" integer NOT NULL');
    expect(sql).toContain('"rate" numeric(9,2)');
    expect(sql).toContain('"total" numeric(19,2) NOT NULL');
    expect(sql).toContain('"total_currency" text NOT NULL');
    expect(sql).toContain('"attributes" jsonb');
    expect(sql.match(/CONSTRAINT "[a-z0-9_]+" CHECK \(/g)).toHaveLength(2);
  });

  it("keeps CORE V1 physical contracts byte-identical in shape and profile", () => {
    const manifest = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "done", type: "boolean", required: true },
      { id: "due", type: "datetime", required: false },
    ]);
    expect(provisioningProfileFor(manifest)).toBe(PROVISIONING_PROFILE);
    const physical = compileProvisioningContract(manifest, scope);
    expect(physical.profile).toBe(PROVISIONING_PROFILE);
    expect(Object.prototype.hasOwnProperty.call(physical.resources[0], "checks")).toBe(false);
  });

  it("refuses bounded additions during additive evolution instead of dropping their CHECK", () => {
    const before = manifestOf([{ id: "code", type: "text", required: true }]);
    const after = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "reference", type: "text", required: false, maxLength: 10 },
    ]);
    expect(() => compileProvisioningTransition(before, after, scope))
      .toThrow(/PROVISIONING_EVOLUTION_REVIEW_REQUIRED/);
  });

  it("keeps the frozen Candidate A operator refusing extended scalar additions", () => {
    const before = compileResourceSchema([{
      id: "widgets", ownership: "application", ...scope,
      fields: [{ id: "code", type: "text", required: true }],
    }], scope);
    const beforeManifest = createSchemaManifest(before);
    const afterManifest = createSchemaManifest(compileResourceSchema([{
      id: "widgets", ownership: "application", ...scope,
      fields: [{ id: "code", type: "text", required: true }, { id: "quantity", type: "integer", required: false }],
    }], scope));
    const plan = planSchemaChanges(beforeManifest, afterManifest.canonicalIr, {
      scope, expectedCurrentDigest: beforeManifest.digest,
    });
    expect(() => renderTrustedAdditiveColumn(plan, beforeManifest, scope)).toThrow();
  });
});

describe("extended scalar validation", () => {
  it("rejects out-of-range and non-integral integers", () => {
    code([{ id: "code", type: "text", required: true }, { id: "n", type: "integer", required: true, default: 2147483648 }]);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "n", type: "integer", required: true, default: 1.5 },
    ])).toThrow(ResourceSchemaError);
  });

  it("rejects decimal defaults that exceed scale or use floating-point numbers", () => {
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "d", type: "decimal", precision: 5, scale: 2, required: true, default: "1.234" },
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "d", type: "decimal", precision: 5, scale: 2, required: true, default: 1.25 as unknown as string },
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "d", type: "decimal", precision: 5, scale: 2, required: true, default: "123.45" },
    ])).not.toThrow();
  });

  it("rejects invalid calendar dates and accepts leap days", () => {
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "d", type: "date", required: false, default: "2026-02-30" },
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "d", type: "date", required: false, default: "2028-02-29" },
    ])).not.toThrow();
  });

  it("requires an explicit JSON byte budget and refuses JSON defaults", () => {
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "j", type: "json", required: false } as never,
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "j", type: "json", maxBytes: 1, required: false, default: "{}" } as never,
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "m", type: "media", required: false } as never,
    ])).toThrow(ResourceSchemaError);
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "l", type: "localized", maxBytes: 4096, required: false, default: "{}" } as never,
    ])).toThrow(ResourceSchemaError);
  });

  it("rejects a money companion collision with a declared field", () => {
    expect(() => manifestOf([
      { id: "code", type: "text", required: true },
      { id: "total", type: "money", precision: 19, scale: 2, required: true },
      { id: "total_currency", type: "text", required: false },
    ])).toThrow(ResourceSchemaError);
  });

  it("maps media and localized documents to bounded jsonb with exact object CHECKs", () => {
    const manifest = manifestOf([
      { id: "code", type: "text", required: true },
      { id: "cover", type: "media", maxBytes: 4096, maxDepth: 8, maxKeys: 1000, required: false },
      { id: "title", type: "localized", maxBytes: 2048, maxDepth: 3, maxKeys: 20, required: true },
    ]);
    expect(provisioningProfileFor(manifest)).toBe(PROVISIONING_PROFILE_V2);
    const fields = new Map(manifest.resources[0]!.fields.map((f) => [f.id, f]));
    expect(fields.get("cover")).toMatchObject({
      logicalType: "media", postgresType: "jsonb", mappingStatus: "MAPPED",
      maxBytes: 4096, maxDepth: 8, maxKeys: 1000,
    });
    expect(fields.get("title")).toMatchObject({
      logicalType: "localized", postgresType: "jsonb", maxDepth: 3, maxKeys: 20,
    });
    const physical = compileProvisioningContract(manifest, scope);
    const checks = physical.resources[0]!.checks ?? [];
    expect(checks.find((c) => c.columns[0] === "cover")?.normalized)
      .toBe("((jsonb_typeof(cover) = 'object'::text) AND (COALESCE(jsonb_typeof((cover -> 'url'::text)), ''::text) = 'string'::text) AND (pg_column_size(cover) <= 4096))");
    expect(checks.find((c) => c.columns[0] === "title")?.normalized)
      .toBe("((jsonb_typeof(title) = 'object'::text) AND (pg_column_size(title) <= 2048))");
    const sql = compileProvisioningTransition(null, manifest, scope).statements.join("\n");
    expect(sql).toContain('"cover" jsonb');
    expect(sql).toContain('jsonb_typeof("cover") = \'object\' AND coalesce(jsonb_typeof("cover" -> \'url\'), \'\') = \'string\'');
    expect(sql).toContain('"title" jsonb NOT NULL');
  });

  it("serializes deterministically and round-trips through canonical IR", () => {
    const ir = compileResourceSchema([resource([
      { id: "code", type: "text", required: true },
      { id: "amount", type: "money", precision: 19, scale: 2, required: true },
      { id: "payload", type: "json", maxBytes: 64, maxDepth: 2, maxKeys: 4, required: false },
    ])], scope);
    const wire = serializeCanonicalSchemaIR(ir);
    expect(wire).toBe(serializeCanonicalSchemaIR(parseCanonicalSchemaIR(JSON.parse(wire))));
    expect(canonicalSchemaDigest(ir)).toBe(canonicalSchemaDigest(parseCanonicalSchemaIR(JSON.parse(wire))));
  });
});
