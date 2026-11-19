import { describe, expect, it } from "vitest";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { compileResourceSchema, createSchemaManifest, provisioningNamespace, provisioningIdentifier as qi, type FieldDefinition, type SchemaCompilationScope } from "..";
import { compileRenameIntent } from "../rename-intent";

const scope: SchemaCompilationScope = {
  applicationId: asApplicationId("app-rename"),
  installationId: asInstallationId("installation-rename"),
};
const fields = (renamed: boolean): readonly FieldDefinition[] => [
  { id: "code", type: "text", required: true },
  { id: renamed ? "title" : "name", type: "text", required: false },
  { id: "done", type: "boolean", required: true },
];
const manifest = (renamed: boolean) =>
  createSchemaManifest(
    compileResourceSchema(
      [{ ...scope, id: "invoices", ownership: "tenant", fields: fields(renamed) }],
      scope,
    ),
  );
const intent = {
  version: 1 as const,
  resourceId: "invoices",
  from: "name",
  to: "title",
  rationale: "The field now holds a localizable document title.",
};

describe("explicit rename-intent contract", () => {
  it("compiles an explicit optional-column rename into non-destructive expand/backfill/validate phases", () => {
    const current = manifest(false), proposed = manifest(true);
    const plan = compileRenameIntent(current, proposed, intent, scope);
    expect(plan.profile).toBe("M03_RENAME_INTENT_V1");
    expect(plan.authorization).toBe("NONE");
    expect(plan.compatibility).toBe("EXPAND_AND_BACKFILL");
    expect(plan.destructive).toBe(false);
    expect(plan.resource).toEqual({ id: "invoices", table: current.resources[0]!.tableName });
    const table = qi(provisioningNamespace(scope)) + "." + qi(current.resources[0]!.tableName);
    expect(plan.phases.expand.statements).toEqual([
      "ALTER TABLE " + table + " ADD COLUMN " + qi("title") + " text",
    ]);
    expect(plan.phases.backfill).toMatchObject({
      sourceColumn: "name",
      targetColumn: "title",
      execution: "SIGNED_BOUNDED_BACKFILL_REQUIRED",
    });
    expect(plan.phases.validate.predicates).toEqual([
      'count(*) FILTER (WHERE "title" IS NULL) = 0',
    ]);
    expect(plan.phases.contract).toMatchObject({ executable: false });
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is a pure artifact: the same inputs produce the same digest", () => {
    const current = manifest(false), proposed = manifest(true);
    expect(compileRenameIntent(current, proposed, intent, scope).digest).toBe(
      compileRenameIntent(current, proposed, { ...intent }, scope).digest,
    );
    expect(current.digest).toBe(manifest(false).digest);
  });

  it("refuses inference, unknown, colliding and same-name renames", () => {
    const current = manifest(false), proposed = manifest(true);
    expect(() => compileRenameIntent(current, proposed, { ...intent, rationale: "" }, scope)).toThrow("RENAME_INTENT_REFUSED");
    expect(() => compileRenameIntent(current, proposed, { ...intent, from: "missing" }, scope)).toThrow("RENAME_INTENT_REFUSED");
    expect(() => compileRenameIntent(current, proposed, { ...intent, to: "code" }, scope)).toThrow("RENAME_INTENT_REFUSED");
    expect(() => compileRenameIntent(current, proposed, { ...intent, from: "title", to: "title" }, scope)).toThrow("RENAME_INTENT_REFUSED");
    expect(() => compileRenameIntent(current, manifest(false), intent, scope)).toThrow("RENAME_INTENT_REFUSED");
  });

  it("refuses a required destination, a type change and unrelated schema drift", () => {
    const current = manifest(false);
    const requiredTarget = createSchemaManifest(
      compileResourceSchema(
        [{ ...scope, id: "invoices", ownership: "tenant", fields: [
          { id: "code", type: "text", required: true },
          { id: "title", type: "text", required: true },
          { id: "done", type: "boolean", required: true },
        ] }],
        scope,
      ),
    );
    expect(() => compileRenameIntent(current, requiredTarget, intent, scope)).toThrow("RENAME_INTENT_REFUSED");
    const retyped = createSchemaManifest(
      compileResourceSchema(
        [{ ...scope, id: "invoices", ownership: "tenant", fields: [
          { id: "code", type: "text", required: true },
          { id: "title", type: "integer", required: false },
          { id: "done", type: "boolean", required: true },
        ] }],
        scope,
      ),
    );
    expect(() => compileRenameIntent(current, retyped, intent, scope)).toThrow("RENAME_INTENT_REFUSED");
    const drifted = createSchemaManifest(
      compileResourceSchema(
        [{ ...scope, id: "invoices", ownership: "tenant", fields: [
          { id: "code", type: "text", required: true },
          { id: "title", type: "text", required: false },
          { id: "done", type: "boolean", required: true },
          { id: "notes", type: "text", required: false },
        ] }],
        scope,
      ),
    );
    expect(() => compileRenameIntent(current, drifted, intent, scope)).toThrow("RENAME_INTENT_REFUSED");
  });

  it("refuses a missing current revision or scope mismatch", () => {
    const proposed = manifest(true);
    expect(() => compileRenameIntent(null, proposed, intent, scope)).toThrow("RENAME_INTENT_REFUSED");
    expect(() => compileRenameIntent(manifest(false), proposed, intent, { ...scope, installationId: asInstallationId("other") })).toThrow("RENAME_INTENT_REFUSED");
  });
});
