import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { parseSchemaManifest } from "./planning";
import type { FieldDefinition, ResourceOwnership } from "./schema";

/** M04-S01. Offline contract compiler, NOT a route, permission check or executor. */
export const CRUD_CONTRACT_VERSION = 2 as const;
export interface ContractBindingIdentity { readonly version: number; readonly digest: string }
const compiledInstances = new WeakSet<object>();
const wireErrors = Object.freeze({ 400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RESOURCE_LIMIT", 503: "RUNTIME_UNAVAILABLE" } as const);
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
  return JSON.stringify(value);
}
export const CRUD_LIMITS = Object.freeze({
  resources: 16, fieldsPerResource: 16, textLength: 4096, maxTextBytes: 16384,
  maxPageSize: 25, maxInputBytes: 65536, maxOutputBytes: 1048576,
  maxRelationDepth: 0, maxMutationBatch: 1,
});
export type CrudAction = "list" | "get" | "create" | "update" | "delete";
export type ContractAction = CrudAction | "custom";
export type CrudErrorCode = "INVALID_CONTRACT" | "INVALID_INPUT" | "INVALID_OUTPUT" | "RUNTIME_UNAVAILABLE";
export class CrudContractError extends Error {
  constructor(readonly code: CrudErrorCode) { super(code); this.name = "CrudContractError"; }
}
function fail(code: CrudErrorCode): never { throw new CrudContractError(code); }

export type CrudValueSchema =
  | Readonly<{ type: "string"; maxLength: number; minLength?: number; pattern?: string; format?: "date-time"; enum?: readonly string[] }>
  | Readonly<{ type: "number" | "boolean" | "null" }>
  | Readonly<{ type: "integer"; minimum: number; maximum: number }>
  | Readonly<{ type: "object"; properties: Readonly<Record<string, Schema>>; required: readonly string[]; additionalProperties: false; minProperties?: number }>
  | Readonly<{ type: "array"; items: Schema; maxItems: number }>
  | Readonly<{ anyOf: readonly Schema[] }>;
type Schema = CrudValueSchema;
type ObjectSchema = Extract<Schema, { type: "object" }>;
export interface CrudOperationDescriptor {
  readonly operationId: string;
  readonly resourceId: string;
  readonly action: ContractAction;
  readonly customAction?: string;
  readonly transactionRequired: boolean;
  readonly idempotencyRequired: boolean;
  readonly method: "get" | "post" | "patch" | "delete";
  readonly path: string;
  readonly input: ObjectSchema;
  readonly output: Schema;
  readonly authorization: Readonly<{
    ownership: ResourceOwnership; permission: string;
    authenticatedInstallationContext: true; requireTenantContext: boolean;
    rowAuthorization: true; fieldAuthorization: true;
    exposedFieldIds: readonly string[]; readFieldIds: readonly string[]; writeFieldIds: readonly string[];
    customInputFieldIds: readonly string[]; customEffects: "NOT_APPLICABLE" | "UNRESOLVED_RUNTIME_REVIEW"; relationshipTraversal: false;
    enforcement: "REQUIRED_NOT_IMPLEMENTED";
  }>;
  readonly cost: Readonly<{
    maxRows: number; maxInputBytes: number; maxOutputBytes: number;
    maxRelationDepth: 0; maxMutationBatch: 1; allowCount: false;
    allowFilter: false; allowSort: false; allowExport: false;
    requireRateLimit: true; requireQueryTimeout: true;
  }>;
  readonly requiresOptimisticConcurrency: boolean;
  readonly runtime: "DISABLED";
}
export interface CrudAdminMetadata {
  readonly resourceId: string;
  readonly ownership: ResourceOwnership;
  readonly fields: readonly Readonly<{ id: string; kind: FieldDefinition["type"]; required: boolean; editable: boolean; widget: "text" | "number" | "checkbox" | "datetime" | "select"; validation: CrudValueSchema; values?: readonly string[] }>[];
  readonly forms: readonly Readonly<{ operationId: string; fields: readonly string[]; permission: string }>[];
  readonly operationAuthorization: readonly Readonly<{ operationId: string; requirements: CrudOperationDescriptor["authorization"] }>[];
  readonly columns: readonly string[];
  readonly states: readonly ["loading", "error", "runtime-disabled"];
  readonly operations: readonly string[];
  readonly runtime: "DISABLED";
}
const ACTIONS = ["list", "get", "create", "update", "delete"] as const;
const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);
function plainRecord(value: unknown, allowed: readonly string[], code: CrudErrorCode): Record<string, unknown> {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) ||
    Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null)) return fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) return fail(code);
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || blockedKeys.has(key) || !allowed.includes(key)) return fail(code);
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !("value" in d)) return fail(code);
    out[key] = d.value;
  }
  return out;
}
function denseArray(value: unknown, max: number, code: CrudErrorCode): unknown[] {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) ||
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail(code);
  const n: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max ||
    Reflect.ownKeys(value).length !== n + 1) return fail(code);
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !("value" in d)) return fail(code);
    out.push(d.value);
  }
  return out;
}
function identifiers(value: unknown, max: number): string[] {
  const out: string[] = [];
  for (const item of denseArray(value, max, "INVALID_CONTRACT")) {
    if (typeof item !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(item) || blockedKeys.has(item)) return fail("INVALID_CONTRACT");
    out.push(item);
  }
  if (!out.length || new Set(out).size !== out.length) return fail("INVALID_CONTRACT");
  return out.sort();
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function object(properties: Record<string, Schema>, required: readonly string[], minProperties?: number): ObjectSchema {
  return { type: "object", properties, required, additionalProperties: false,
    ...(minProperties !== undefined ? { minProperties } : {}) };
}
const token: Schema = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$(?![\\s\\S])" };
const cursor: Schema = { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$(?![\\s\\S])" };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
function fieldSchema(field: FieldDefinition): Schema {
  let schema: Schema;
  switch (field.type) {
    case "text": schema = { type: "string", maxLength: CRUD_LIMITS.textLength, pattern: "^[^\\u0000\\uD800-\\uDFFF]*$(?![\\s\\S])" }; break;
    case "number": schema = { type: "number" }; break;
    case "boolean": schema = { type: "boolean" }; break;
    case "datetime":
      schema = { type: "string", maxLength: 24, format: "date-time",
        pattern: "^(?!0000-)\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$(?![\\s\\S])" }; break;
    case "enum": schema = { type: "string", maxLength: 63, enum: [...field.values] }; break;
    case "relation": return fail("INVALID_CONTRACT");
  }
  return field.required ? schema : nullable(schema);
}
function validate(schema: Schema, value: unknown, code: CrudErrorCode): unknown {
  if ("anyOf" in schema) {
    for (const variant of schema.anyOf) {
      try { return validate(variant, value, code); }
      catch (error) { if (!(error instanceof CrudContractError)) throw error; }
    }
    return fail(code);
  }
  switch (schema.type) {
    case "null": return value === null ? null : fail(code);
    case "boolean": return typeof value === "boolean" ? value : fail(code);
    case "number": return typeof value === "number" && Number.isFinite(value) ? value : fail(code);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum ? value : fail(code);
    case "string": {
      if (typeof value !== "string" || value.length > schema.maxLength * 2 ||
        [...value].length > schema.maxLength || [...value].length < (schema.minLength ?? 0) ||
        (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) ||
        /[\uD800-\uDFFF]/u.test(value) || value.includes("\u0000") || Buffer.byteLength(value, "utf8") > CRUD_LIMITS.maxTextBytes ||
        (schema.enum !== undefined && !schema.enum.includes(value))) return fail(code);
      if (schema.format === "date-time") {
        const date = new Date(value);
        if (!value.endsWith("Z") || value.startsWith("0000-") || Number.isNaN(date.getTime()) ||
          date.toISOString().slice(0, 19) !== value.slice(0, 19)) return fail(code);
      }
      return value;
    }
    case "array": return denseArray(value, schema.maxItems, code).map(item => validate(schema.items, item, code));
    case "object": {
      const source = plainRecord(value, Object.keys(schema.properties), code);
      if (schema.required.some(key => !Object.hasOwn(source, key)) ||
        Object.keys(source).length < (schema.minProperties ?? 0)) return fail(code);
      return Object.fromEntries(Object.keys(schema.properties).filter(key => Object.hasOwn(source, key))
        .map(key => [key, validate(schema.properties[key]!, source[key], code)]));
    }
  }
}
function checked(schema: Schema, value: unknown, code: CrudErrorCode, bytes: number): unknown {
  const result = validate(schema, value, code);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > bytes) return fail(code);
  return freeze(result);
}
function typeSource(schema: Schema): string {
  if ("anyOf" in schema) return schema.anyOf.map(typeSource).join(" | ");
  switch (schema.type) {
    case "object": {
      const entries = Object.entries(schema.properties);
      const shape = (additional?: string) => "{ " + entries.map(([key, value]) =>
        "readonly " + JSON.stringify(key) + (schema.required.includes(key) || additional === key ? "" : "?") + ": " + typeSource(value) + ";").join(" ") + " }";
      return schema.minProperties === 1 && schema.required.length === 0
        ? "(" + entries.map(([key]) => shape(key)).join(" | ") + ")" : shape();
    }
    case "array": return "ReadonlyArray<" + typeSource(schema.items) + ">";
    case "string": return schema.enum ? schema.enum.map(v => JSON.stringify(v)).join(" | ") : "string";
    case "integer": return "number";
    default: return schema.type;
  }
}
function openApi(operations: readonly CrudOperationDescriptor[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorResponses = Object.fromEntries(Object.entries(wireErrors).map(([status, code]) => [status, {
    description: code, content: { "application/json": { schema: { type: "object", properties: { code: { type: "string", enum: [code] } }, required: ["code"], additionalProperties: false } } },
  }]));
  for (const op of operations) {
    const parameters: object[] = [];
    if (op.path.endsWith("/{id}")) parameters.push({ name: "id", in: "path", required: true, schema: token });
    if (op.requiresOptimisticConcurrency) parameters.push({ name: "X-Resource-Version", in: "header", required: true, schema: token,
      description: "Proposed opaque version token; runtime must atomically compare it before mutation." });
    if (op.idempotencyRequired) parameters.push({ name: "Idempotency-Key", in: "header", required: true, schema: token });
    if (op.action === "list") {
      for (const [name, schema] of Object.entries(op.input.properties))
        parameters.push({ name, in: "query", required: false, schema });
    }
    const data = op.input.properties.data;
    const status = op.action === "create" ? "201" : "200";
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      description: "Offline proposed contract. No route or authorization enforcement exists.",
      security: [{ futureBearer: [] }],
      parameters,
      ...(data ? { requestBody: { required: true, content: { "application/json": { schema: data } } } } : {}),
      responses: {
        [status]: { description: "Proposed successful response after runtime approval", content: { "application/json": { schema: op.output } } },
        ...errorResponses,
      },
      "x-vibress-runtime": op.runtime, "x-vibress-authorization": op.authorization, "x-vibress-cost": op.cost,
      "x-vibress-transaction-required": op.transactionRequired, "x-vibress-idempotency-required": op.idempotencyRequired,
    };
  }
  return freeze({ openapi: "3.1.0", info: { title: "Vibress generated CRUD (offline)", version: "2.0.0",
    description: "Private design artifact; not an exposed API. Authentication and persistence are not implemented." },
    "x-vibress-runtime": "DISABLED", paths,
    components: { securitySchemes: { futureBearer: { type: "http", scheme: "bearer", description: "Proposed only; no token validation provided." } } } });
}

/**
 * trustedConfiguration MUST come from reviewed internal configuration, not a request.
 * It binds scope and expected manifest digest, and explicitly selects exposed fields.
 * A digest proves consistency, not authenticity. No runtime capability is minted.
 * S01 exposes the same explicitly selected scalar fields for read/write. If a required
 * field is hidden (even with a default), create cannot be compiled safely; refuse.
 */
export function compileCrudContracts(manifestInput: unknown, trustedConfiguration: unknown) {
  const cfg = plainRecord(trustedConfiguration, ["applicationId", "installationId", "expectedManifestDigest", "exposure", "customOperations"], "INVALID_CONTRACT");
  let manifest: ReturnType<typeof parseSchemaManifest>;
  try { manifest = parseSchemaManifest(manifestInput); } catch { return fail("INVALID_CONTRACT"); }
  if (cfg.applicationId !== manifest.applicationId || cfg.installationId !== manifest.installationId ||
    cfg.expectedManifestDigest !== manifest.digest) return fail("INVALID_CONTRACT");
  const exposure = new Map<string, { fields: string[]; readOnly: string[] }>();
  for (const entry of denseArray(cfg.exposure, CRUD_LIMITS.resources, "INVALID_CONTRACT")) {
    const item = plainRecord(entry, ["resourceId", "fields", "readOnly"], "INVALID_CONTRACT");
    if (typeof item.resourceId !== "string" || blockedKeys.has(item.resourceId) || exposure.has(item.resourceId)) return fail("INVALID_CONTRACT");
    const fields = identifiers(item.fields, CRUD_LIMITS.fieldsPerResource);
    const readOnly = item.readOnly === undefined ? [] : identifiers(item.readOnly, CRUD_LIMITS.fieldsPerResource);
    if (readOnly.some(id => !fields.includes(id))) return fail("INVALID_CONTRACT");
    exposure.set(item.resourceId, { fields, readOnly });
  }
  if (!exposure.size) return fail("INVALID_CONTRACT");
  const ops: CrudOperationDescriptor[] = [], admin: CrudAdminMetadata[] = [];
  const custom = new Map<string, { resourceId: string; actionId: string; fields: string[] }>();
  if (cfg.customOperations !== undefined) for (const entry of denseArray(cfg.customOperations, CRUD_LIMITS.resources, "INVALID_CONTRACT")) {
    const item = plainRecord(entry, ["resourceId", "actionId", "fields"], "INVALID_CONTRACT");
    if (typeof item.resourceId !== "string" || !exposure.has(item.resourceId) || typeof item.actionId !== "string" ||
      !/^[a-z][a-z0-9_]{0,62}$/.test(item.actionId) || blockedKeys.has(item.actionId) || ACTIONS.some(a => a === item.actionId)) return fail("INVALID_CONTRACT");
    const key = item.resourceId + "." + item.actionId;
    if (custom.has(key)) return fail("INVALID_CONTRACT");
    custom.set(key, { resourceId: item.resourceId, actionId: item.actionId, fields: identifiers(item.fields, CRUD_LIMITS.fieldsPerResource) });
  }
  for (const resourceId of [...exposure.keys()].sort()) {
    const resource = manifest.canonicalIr.resources.find(r => r.id === resourceId);
    if (!resource) return fail("INVALID_CONTRACT");
    const { fields: fieldIds, readOnly } = exposure.get(resourceId)!;
    const fields = fieldIds.map(id => {
      const field = resource.fields.find(f => f.id === id);
      if (!field || field.type === "relation") return fail("INVALID_CONTRACT");
      return field;
    });
    if (resource.fields.some(f => f.required && !fieldIds.includes(f.id))) return fail("INVALID_CONTRACT");
    const properties = Object.fromEntries(fields.map(f => [f.id, fieldSchema(f)]));
    const editable = fields.filter(f => !readOnly.includes(f.id));
    if (!editable.length || fields.some(f => f.required && readOnly.includes(f.id))) return fail("INVALID_CONTRACT");
    const writable = Object.fromEntries(editable.map(f => [f.id, fieldSchema(f)]));
    const create = object(writable, editable.filter(f => f.required).map(f => f.id));
    const patch = object(writable, [], 1);
    const row = object({ id: token, version: token, data: object(properties, fieldIds) }, ["id", "version", "data"]);
    for (const action of ACTIONS) {
      const method = action === "create" ? "post" : action === "update" ? "patch" : action === "delete" ? "delete" : "get";
      const item = action === "get" || action === "update" || action === "delete";
      const concurrency = action === "update" || action === "delete";
      const input = action === "list" ? object({ limit: { type: "integer", minimum: 1, maximum: CRUD_LIMITS.maxPageSize }, cursor }, [])
        : action === "create" ? object({ data: create }, ["data"])
        : action === "update" ? object({ id: token, version: token, data: patch }, ["id", "version", "data"])
        : concurrency ? object({ id: token, version: token }, ["id", "version"]) : object({ id: token }, ["id"]);
      const output = action === "list" ? object({ items: { type: "array", items: row, maxItems: CRUD_LIMITS.maxPageSize }, nextCursor: nullable(cursor) }, ["items", "nextCursor"])
        : action === "delete" ? object({ id: token }, ["id"]) : row;
      ops.push({
        operationId: resourceId + "." + action, resourceId, action, method,
        path: "/generated/v1/" + resourceId + (item ? "/{id}" : ""), input, output,
        authorization: { ownership: resource.ownership, permission: "resource:" + resourceId + ":" + action,
          authenticatedInstallationContext: true, requireTenantContext: resource.ownership === "tenant",
          rowAuthorization: true, fieldAuthorization: true, exposedFieldIds: fieldIds,
          readFieldIds: action === "delete" ? [] : Object.keys(properties),
          writeFieldIds: action === "create" || action === "update" ? Object.keys(writable) : [],
          customInputFieldIds: [], customEffects: "NOT_APPLICABLE", relationshipTraversal: false, enforcement: "REQUIRED_NOT_IMPLEMENTED" },
        cost: { maxRows: action === "list" ? CRUD_LIMITS.maxPageSize : 1, maxInputBytes: CRUD_LIMITS.maxInputBytes,
          maxOutputBytes: CRUD_LIMITS.maxOutputBytes, maxRelationDepth: 0, maxMutationBatch: 1,
          allowCount: false, allowFilter: false, allowSort: false, allowExport: false,
          requireRateLimit: true, requireQueryTimeout: true },
        requiresOptimisticConcurrency: concurrency, transactionRequired: action !== "get" && action !== "list", idempotencyRequired: false, runtime: "DISABLED",
      });
    }
    for (const [key, entry] of [...custom.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (entry.resourceId !== resourceId) continue;
      if (entry.fields.some(id => !Object.hasOwn(writable, id))) return fail("INVALID_CONTRACT");
      const base = ops.find(op => op.resourceId === resourceId && op.action === "update")!;
      ops.push({ ...base, action: "custom", customAction: entry.actionId, operationId: key,
        method: "post", path: "/generated/v1/" + resourceId + "/actions/" + entry.actionId + "/{id}",
        input: object({ id: token, version: token, idempotencyKey: token,
          data: object(Object.fromEntries(entry.fields.map(id => [id, writable[id]!])), entry.fields) },
        ["id", "version", "idempotencyKey", "data"]), output: row,
        authorization: { ...base.authorization, permission: "resource:" + resourceId + ":action:" + entry.actionId,
          writeFieldIds: entry.fields, customInputFieldIds: entry.fields, customEffects: "UNRESOLVED_RUNTIME_REVIEW" },
        transactionRequired: true, idempotencyRequired: true });
    }
    admin.push({ resourceId, ownership: resource.ownership,
      fields: fields.map(f => ({ id: f.id, kind: f.type, required: f.required, editable: !readOnly.includes(f.id),
        widget: f.type === "enum" ? "select" : f.type === "boolean" ? "checkbox" : f.type === "datetime" ? "datetime" : f.type === "number" ? "number" : "text",
        validation: properties[f.id]!, ...(f.type === "enum" ? { values: [...f.values] } : {}) })),
      forms: (["create", "update"] as const).map(a => ({ operationId: resourceId + "." + a,
        fields: editable.map(f => f.id), permission: "resource:" + resourceId + ":" + a })),
      operationAuthorization: ops.filter(op => op.resourceId === resourceId).map(op => ({ operationId: op.operationId, requirements: op.authorization })),
      columns: fieldIds, states: ["loading", "error", "runtime-disabled"],
      operations: ops.filter(op => op.resourceId === resourceId).map(op => op.operationId), runtime: "DISABLED" });
  }
  const operations = freeze(ops);
  // Pre-generation identity: canonical sorted-key JSON, ordered descriptor arrays,
  // scope, manifest, wire and semantic contract. Excludes source and artifact digest.
  const payload = { contractVersion: CRUD_CONTRACT_VERSION, runtime: "DISABLED" as const, manifestDigest: manifest.digest,
    operations, admin: freeze(admin), openapi: openApi(operations) };
  const bindingIdentity = freeze({version: CRUD_CONTRACT_VERSION, digest: createHash("sha256").update(canonicalJson({
    domain: "VIBRESS-M04-MOCK-BINDING-V2", applicationId: manifest.applicationId, installationId: manifest.installationId,
    payload, limits: CRUD_LIMITS, wireErrors, semantics: { mockOnly: true, normalizedUtf8Budgets: true, requestRelativeResponseChecks: true, automaticRetry: false, timeoutProvesRollback: false },
  }), "utf8").digest("hex")});
  const generated = { ...payload, bindingIdentity,
    typescript: "// Offline mock-only declarations. No runtime authorization implementation.\n" +
      "export type GeneratedErrorCode = " + Object.values(wireErrors).map(code => JSON.stringify(code)).join(" | ") + ";\n" +
      "export interface GeneratedOptions { readonly timeoutMs?: number; readonly signal?: AbortSignal; }\n" +
      "export type GeneratedResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: GeneratedErrorCode | \"INVALID_RESPONSE\" | \"CANCELLED\" | \"TIMEOUT\" | \"TRANSPORT_FAILURE\" };\n" +
      "export interface GeneratedClient {\n" + operations.map(op =>
        "  " + JSON.stringify(op.operationId) + "(input: " + typeSource(op.input) + ", options?: GeneratedOptions): Promise<GeneratedResult<" + typeSource(op.output) + ">>;").join("\n") + "\n}\n" +
      "const bindingRequirement = Object.freeze(" + JSON.stringify(bindingIdentity) + ");\n" +
      "export const expectedBindingIdentity = bindingRequirement;\n" +
      "export interface GeneratedMockBinding { readonly bindingIdentity: Readonly<{version: number; digest: string}>; bindContract(expected: Readonly<{version:number;digest:string}>): (operation:string,input:unknown,options?:GeneratedOptions)=>Promise<GeneratedResult<unknown>>; }\n" +
      "export function bindGeneratedMockClient(client: GeneratedMockBinding): GeneratedClient {\n" +
      "  if (!client || client.bindingIdentity?.version !== bindingRequirement.version || client.bindingIdentity.digest !== bindingRequirement.digest || typeof client.bindContract !== \"function\") throw new Error(\"INVALID_CONTRACT\");\n" +
      "  const invoke = client.bindContract(bindingRequirement);\n  const bound: GeneratedClient = {\n" +
      operations.map(op => "    " + JSON.stringify(op.operationId) + ": (input, options) => invoke(" + JSON.stringify(op.operationId) + ", input, options) as Promise<GeneratedResult<" + typeSource(op.output) + ">>,").join("\n") + "\n  };\n  return Object.freeze(bound);\n}\n",
  };
  const digest = createHash("sha256").update(JSON.stringify(generated), "utf8").digest("hex");
  const descriptor = (id: string) => operations.find(op => op.operationId === id) ?? fail("INVALID_INPUT");
  const compiled = Object.freeze({
    ...generated, digest,
    validateInput(id: string, value: unknown): unknown { return checked(descriptor(id).input, value, "INVALID_INPUT", CRUD_LIMITS.maxInputBytes); },
    validateOutput(id: string, value: unknown): unknown {
      const op = operations.find(candidate => candidate.operationId === id) ?? fail("INVALID_OUTPUT");
      return checked(op.output, value, "INVALID_OUTPUT", CRUD_LIMITS.maxOutputBytes);
    },
    assertRuntimeAvailable(): never { return fail("RUNTIME_UNAVAILABLE"); },
  });
  compiledInstances.add(compiled);
  return compiled;
}


export type CompiledCrudContracts = ReturnType<typeof compileCrudContracts>;
export type MockClientErrorCode = (typeof wireErrors)[keyof typeof wireErrors] | "INVALID_RESPONSE" | "CANCELLED" | "TIMEOUT" | "TRANSPORT_FAILURE";
export type MockClientResult<T = unknown> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: MockClientErrorCode }>;
export interface MockClientOptions { readonly timeoutMs?: number; readonly signal?: AbortSignal }
export interface MockContractRequest {
  readonly operationId: string;
  readonly method: CrudOperationDescriptor["method"];
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}
export interface MockContractTransport {
  /** Test/in-memory only. No URL, origin, credential, principal or tenant input. */
  send(request: MockContractRequest, signal: AbortSignal): Promise<unknown>;
}
const errorCodes: Readonly<Partial<Record<number, MockClientErrorCode>>> = wireErrors;
const clientError = (code: MockClientErrorCode): MockClientResult => Object.freeze({ ok: false, code });
/** Explicitly injected trusted mock only. No built-in network implementation.
 * No transport is installed by default; this cannot enable actual runtime.
 * A timed out/cancelled mock may continue; never automatically retry mutations.
 */
export function createMockContractClient(contracts: CompiledCrudContracts,
  config?: Readonly<{ mode: "MOCK_ONLY"; transport: MockContractTransport }>) {
  if (!compiledInstances.has(contracts)) return fail("INVALID_CONTRACT");
  const bindingIdentity: ContractBindingIdentity = contracts.bindingIdentity;
  const invoke = async (operationId: string, input: unknown, options: MockClientOptions = {}): Promise<MockClientResult> => {
      if (config?.mode !== "MOCK_ONLY") return clientError("RUNTIME_UNAVAILABLE");
      const op = contracts.operations.find(candidate => candidate.operationId === operationId);
      if (!op) return clientError("INVALID_INPUT");
      let validated: Record<string, unknown>;
      try {
        validated = plainRecord(contracts.validateInput(operationId, input), Object.keys(op.input.properties), "INVALID_INPUT");
      } catch { return clientError("INVALID_INPUT"); }
      const timeoutMs = options.timeoutMs ?? 1000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) return clientError("INVALID_INPUT");
      if (options.signal?.aborted) return clientError("CANCELLED");
      let route = op.path;
      if (typeof validated.id === "string") route = route.replace("{id}", encodeURIComponent(validated.id));
      if (op.action === "list") {
        const query = ["limit", "cursor"].filter(k => Object.hasOwn(validated, k))
          .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(validated[k]))).join("&");
        if (query) route += "?" + query;
      }
      const headers: Record<string, string> = {};
      if (typeof validated.version === "string") headers["X-Resource-Version"] = validated.version;
      if (typeof validated.idempotencyKey === "string") headers["Idempotency-Key"] = validated.idempotencyKey;
      const request = freeze({ operationId, method: op.method, path: route, headers,
        ...(Object.hasOwn(validated, "data") ? { body: validated.data } : {}) });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const interrupted = new Promise<MockClientResult>(resolve => {
          onAbort = () => { resolve(clientError("CANCELLED")); controller.abort(); };
          options.signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => { resolve(clientError("TIMEOUT")); controller.abort(); }, timeoutMs);
        });
        const exchange = async (): Promise<MockClientResult> => {
          let raw: unknown;
          try { raw = await config.transport.send(request, controller.signal); }
          catch { return clientError("TRANSPORT_FAILURE"); }
          try {
            const response = plainRecord(raw, ["status", "body"], "INVALID_OUTPUT");
            const status = response.status;
            if (typeof status !== "number" || !Number.isInteger(status)) return clientError("INVALID_RESPONSE");
            if (status !== (op.action === "create" ? 201 : 200)) {
              const body = plainRecord(response.body, ["code"], "INVALID_OUTPUT");
              const code = errorCodes[status];
              return code && body.code === code ? clientError(code) : clientError("INVALID_RESPONSE");
            }
            const value = contracts.validateOutput(operationId, response.body);
            // Request-relative invariants cannot be proven by response schemas alone.
            if (op.action === "list") {
              const body = plainRecord(value, ["items", "nextCursor"], "INVALID_OUTPUT");
              if (!Array.isArray(body.items) || body.items.length > (typeof validated.limit === "number" ? validated.limit : CRUD_LIMITS.maxPageSize)) return clientError("INVALID_RESPONSE");
            } else if (typeof validated.id === "string") {
              const body = plainRecord(value, op.action === "delete" ? ["id"] : ["id", "version", "data"], "INVALID_OUTPUT");
              if (body.id !== validated.id) return clientError("INVALID_RESPONSE");
            }
            return Object.freeze({ ok: true, value });
          } catch { return clientError("INVALID_RESPONSE"); }
        };
        return await Promise.race([interrupted, exchange()]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) options.signal?.removeEventListener("abort", onAbort);
      }
  };
  // A supported client owns the compiled identity and its validated invocation.
  // Reject detached/copied methods (receiver check); not a hostile JS sandbox.
  const client = Object.freeze({ bindingIdentity, invoke,
    bindContract(expected: ContractBindingIdentity): typeof invoke {
      if (this !== client) return fail("INVALID_CONTRACT");
      const identity = plainRecord(expected, ["version", "digest"], "INVALID_CONTRACT");
      if (identity.version !== bindingIdentity.version || identity.digest !== bindingIdentity.digest) return fail("INVALID_CONTRACT");
      return invoke;
    },
  });
  return client;
}
