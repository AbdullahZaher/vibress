import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compileCrudContracts, CRUD_LIMITS, type CrudAction } from "../index";
import { compileResourceSchema, defineResource } from "../schema";
import { createSchemaManifest } from "../planning";
import { crmScope } from "../fixtures/crm";

function fixture() {
  const customers = defineResource({ ...crmScope, id: "customers", ownership: "tenant", fields: [
    { id: "name", type: "text", required: true },
    { id: "active", type: "boolean", required: false },
    { id: "status", type: "enum", values: ["lead", "client"], required: false },
    { id: "private_note", type: "text", required: false, default: "sensitive_default" },
  ] });
  const settings = defineResource({ ...crmScope, id: "settings", ownership: "application", fields: [
    { id: "amount", type: "number", required: true },
    { id: "occurred_at", type: "datetime", required: false },
  ] });
  const ir = compileResourceSchema([customers, settings], crmScope);
  const manifest = createSchemaManifest(ir);
  const cfg = { ...crmScope, expectedManifestDigest: manifest.digest, exposure: [
    { resourceId: "customers", fields: ["name", "active", "status"] },
    { resourceId: "settings", fields: ["amount", "occurred_at"] },
  ] };
  return { customers, settings, manifest, cfg, compiled: compileCrudContracts(manifest, cfg) };
}
const row = () => ({ id: "row_1", version: "rev_1", data: { name: "أحمد", active: null, status: "lead" } });
const assertError = (fn: () => unknown, code: string) => expect(fn).toThrow(new RegExp("^" + code + "$"));

describe("M04-S01 restricted pure CRUD contracts", () => {
  it("compiles five deterministic operations per explicitly selected resource and canonical scope", () => {
    const { manifest, cfg, compiled } = fixture();
    const reversed = compileCrudContracts(manifest, { ...cfg, exposure: [...cfg.exposure].reverse().map(e => ({ ...e, fields: [...e.fields].reverse() })) });
    expect(compiled.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(reversed.digest).toBe(compiled.digest);
    expect(reversed.operations).toEqual(compiled.operations);
    expect(reversed.typescript).toBe(compiled.typescript);
    expect(compiled.operations).toHaveLength(10);
    expect(new Set(compiled.operations.map(op => op.operationId)).size).toBe(10);
    expect(Object.isFrozen(compiled.operations[0]?.input.properties)).toBe(true);
    expect(compiled.runtime).toBe("DISABLED");
    assertError(() => compiled.assertRuntimeAvailable(), "RUNTIME_UNAVAILABLE");
  });
  it("requires an exact trusted manifest and explicit exposure, never caller-selected tenant identity", () => {
    const { manifest, cfg } = fixture();
    for (const invalid of [
      { ...cfg, installationId: "wrong" }, { ...cfg, applicationId: "wrong" },
      { ...cfg, expectedManifestDigest: "0".repeat(64) }, { ...cfg, tenantId: "victim" },
      { ...cfg, exposure: [] }, { ...cfg, exposure: [cfg.exposure[0], cfg.exposure[0]] },
      { ...cfg, exposure: [{ resourceId: "customers", fields: ["active"] }] },
      { ...cfg, exposure: [{ resourceId: "customers", fields: ["name", "id"] }] },
      { ...cfg, exposure: [{ resourceId: "missing", fields: ["name"] }] },
    ]) assertError(() => compileCrudContracts(manifest, invalid), "INVALID_CONTRACT");
    assertError(() => compileCrudContracts({ ...manifest, digest: "0".repeat(64) }, cfg), "INVALID_CONTRACT");
  });
  it("rejects relation exposure rather than speculating about relationship authorization", () => {
    const { customers, settings } = fixture();
    const contacts = defineResource({ ...crmScope, id: "contacts", ownership: "tenant", fields: [
      { id: "customer", type: "relation", required: false, targetResource: "customers" },
    ] });
    const manifest = createSchemaManifest(compileResourceSchema([customers, settings, contacts], crmScope));
    assertError(() => compileCrudContracts(manifest, { ...crmScope, expectedManifestDigest: manifest.digest,
      exposure: [{ resourceId: "contacts", fields: ["customer"] }] }), "INVALID_CONTRACT");
  });
  it("keeps private fields, literal defaults, physical schema names and installation scope out of generated OpenAPI, Admin and client declarations", () => {
    const { compiled, manifest } = fixture();
    const exposed = JSON.stringify([compiled.openapi, compiled.admin, compiled.typescript]);
    for (const hidden of ["private_note", "sensitive_default", manifest.resources[0]?.tableName, crmScope.installationId]) {
      expect(hidden).toBeTruthy(); expect(exposed).not.toContain(hidden!);
    }
    const spec = compiled.openapi;
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toHaveLength(4);
    expect(spec.paths["/generated/v1/customers/{id}"]).toHaveProperty("patch");
    expect(spec["x-vibress-runtime"]).toBe("DISABLED");
    expect(compiled.admin[0]?.fields.map(field => field.id)).toEqual(["active", "name", "status"]);
  });
  it("declares row and field enforcement, tenant context and budgets but never claims enforcement", () => {
    const { compiled } = fixture();
    for (const op of compiled.operations) {
      expect(op.authorization).toMatchObject({ rowAuthorization: true, fieldAuthorization: true,
        authenticatedInstallationContext: true, enforcement: "REQUIRED_NOT_IMPLEMENTED", relationshipTraversal: false,
        requireTenantContext: op.resourceId === "customers" });
      expect(op.cost).toMatchObject({ maxRelationDepth: 0, maxMutationBatch: 1, allowCount: false,
        allowFilter: false, allowSort: false, allowExport: false, requireRateLimit: true, requireQueryTimeout: true });
      expect(op.runtime).toBe("DISABLED");
    }
  });
  it.each([
    ["list", { limit: 2, cursor: "opaque" }],
    ["get", { id: "row_1" }],
    ["create", { data: { name: "عميل", active: false } }],
    ["update", { id: "row_1", version: "rev_1", data: { status: null } }],
    ["delete", { id: "row_1", version: "rev_1" }],
  ] satisfies [CrudAction, unknown][])("accepts valid %s input and snapshots immutable JSON", (action, input) => {
    const { compiled } = fixture();
    const validated = compiled.validateInput("customers." + action, input);
    expect(validated).toEqual(input);
    expect(Object.isFrozen(validated)).toBe(true);
  });
  it.each([0, -1, 26, 1.5, "2", Infinity, NaN])("rejects invalid page limit %s", limit => {
    assertError(() => fixture().compiled.validateInput("customers.list", { limit }), "INVALID_INPUT");
  });
  it.each(["filter", "sort", "count", "aggregate", "search", "export", "include", "tenant_id", "application_id", "installation_id"])("rejects undeclared query/authority key %s", key => {
    assertError(() => fixture().compiled.validateInput("customers.list", { [key]: true }), "INVALID_INPUT");
  });
  it("rejects mass assignment, null required values, unknown enum, missing version and empty patch", () => {
    const { compiled } = fixture();
    for (const data of [{}, { name: null }, { name: "x", status: "unknown" }, { name: "x", private_note: "leak" },
      { name: "x", tenant_id: "other" }, { name: "x".repeat(CRUD_LIMITS.textLength + 1) }])
      assertError(() => compiled.validateInput("customers.create", { data }), "INVALID_INPUT");
    for (const input of [{ id: "row_1", data: { active: true } }, { id: "row_1", version: "rev", data: {} },
      { id: "row_1", version: "rev\n", data: { active: true } }])
      assertError(() => compiled.validateInput("customers.update", input), "INVALID_INPUT");
    assertError(() => compiled.validateInput("customers.delete", { id: "row_1" }), "INVALID_INPUT");
  });
  it("validates finite numbers and fixed valid UTC calendar timestamps", () => {
    const { compiled } = fixture();
    const good = { data: { amount: 12.5, occurred_at: "2026-11-18T00:00:00.000Z" } };
    expect(compiled.validateInput("settings.create", good)).toEqual(good);
    for (const data of [{ amount: NaN }, { amount: Infinity }, { amount: "12" },
      { amount: 1, occurred_at: "2026-02-30T00:00:00Z" }, { amount: 1, occurred_at: "2026-01-01T00:00:00+03:00" }])
      assertError(() => compiled.validateInput("settings.create", { data }), "INVALID_INPUT");
  });
  it("rejects proxies, accessors, prototype tricks, hidden keys and decorated arrays without invoking their code", () => {
    const { compiled } = fixture();
    let effects = 0;
    const proxy = new Proxy({}, { ownKeys() { effects++; throw Error("trap"); } });
    const getter = Object.defineProperty({}, "limit", { enumerable: true, get() { effects++; return 1; } });
    const hidden = Object.defineProperty({}, "limit", { value: 1 });
    for (const input of [proxy, getter, hidden, Object.create({ limit: 1 }), JSON.parse('{"__proto__":{}}'), { [Symbol("extra")]: 1 }])
      assertError(() => compiled.validateInput("customers.list", input), "INVALID_INPUT");
    const items = [row()];
    Object.defineProperty(items, "map", { value: () => { effects++; } });
    assertError(() => compiled.validateOutput("customers.list", { items, nextCursor: null }), "INVALID_OUTPUT");
    expect(effects).toBe(0);
  });
  it("validates exact output projection, required fields, dense pagination and bounded list length", () => {
    const { compiled } = fixture();
    expect(compiled.validateOutput("customers.get", row())).toEqual(row());
    expect(compiled.validateOutput("customers.list", { items: [row()], nextCursor: null })).toEqual({ items: [row()], nextCursor: null });
    for (const data of [{ ...row().data, private_note: "secret" }, { name: "x" }, { ...row().data, active: "yes" }])
      assertError(() => compiled.validateOutput("customers.get", { ...row(), data }), "INVALID_OUTPUT");
    assertError(() => compiled.validateOutput("customers.list", { items: Array.from({ length: 26 }, row), nextCursor: null }), "INVALID_OUTPUT");
    assertError(() => compiled.validateOutput("customers.list", { items: new Array(1), nextCursor: null }), "INVALID_OUTPUT");
    assertError(() => compiled.validateOutput("customers.list", { items: [], nextCursor: null, total: 100 }), "INVALID_OUTPUT");
    assertError(() => compiled.validateOutput("customers.delete", { id: "row_1", tenant_id: "secret" }), "INVALID_OUTPUT");
  });
  it("caps serialized payload size independently of per-field limits", () => {
    const fields = Array.from({ length: 16 }, (_, i) => ({ id: "field_" + i, type: "text" as const, required: true }));
    const manifest = createSchemaManifest(compileResourceSchema([defineResource({ ...crmScope, id: "payloads", ownership: "tenant", fields })], crmScope));
    const compiled = compileCrudContracts(manifest, { ...crmScope, expectedManifestDigest: manifest.digest, exposure: [{ resourceId: "payloads", fields: fields.map(f => f.id) }] });
    const data = Object.fromEntries(fields.map(f => [f.id, "ع".repeat(4096)]));
    assertError(() => compiled.validateInput("payloads.create", { data }), "INVALID_INPUT");
    assertError(() => compiled.validateOutput("payloads.list", { items: Array.from({ length: 25 }, (_, i) => ({ id: "row_" + i, version: "v", data })), nextCursor: null }), "INVALID_OUTPUT");
  });
  it("generates syntactically and semantically typechecked external-consumer declarations", () => {
    const { compiled } = fixture();
    const file = "/m04-generated-contract.ts";
    const source = compiled.typescript + "\ndeclare const client: GeneratedClient;\n";
    function diagnostics(suffix: string) {
      const options: ts.CompilerOptions = { noEmit: true, strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true,
        types: [], target: ts.ScriptTarget.ES2022 };
      const host = ts.createCompilerHost(options);
      const original = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, onError, fresh) => name === file
        ? ts.createSourceFile(file, source + suffix, lang, true) : original(name, lang, onError, fresh);
      return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    }
    expect(diagnostics('void client["customers.create"]({data:{name:"x",status:"lead"}});')).toHaveLength(0);
    expect(diagnostics('void client["customers.update"]({id:"x",version:"v",data:{active:null}});')).toHaveLength(0);
    for (const invalid of [
      'void client["customers.update"]({id:"x",version:"v",data:{}});',
      'void client["customers.update"]({id:"x",version:"v",data:{name:null}});',
      'void client["customers.update"]({id:"x",version:"v",data:{status:"other"}});',
      'void client["customers.update"]({id:"x",version:"v",data:{active:undefined}});',
      'void client["customers.update"]({id:"x",data:{private_note:"x"}});',
    ]) expect(diagnostics(invalid).length).toBeGreaterThan(0);
  });
});
