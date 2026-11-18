import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { parseSchemaManifest } from "./planning";
import type { FieldDefinition, ResourceOwnership } from "./schema";

/** M04-S01. Offline contract compiler, NOT a route, permission check or executor. */
export const CRUD_CONTRACT_VERSION = 1 as const;
export const CRUD_LIMITS = Object.freeze({
  resources: 16, fieldsPerResource: 16, textLength: 4096,
  maxPageSize: 25, maxInputBytes: 65536, maxOutputBytes: 1048576,
  maxRelationDepth: 0, maxMutationBatch: 1,
});
export type CrudAction = "list" | "get" | "create" | "update" | "delete";
export type CrudErrorCode = "INVALID_CONTRACT" | "INVALID_INPUT" | "INVALID_OUTPUT" | "RUNTIME_UNAVAILABLE";
export class CrudContractError extends Error {
  constructor(readonly code: CrudErrorCode) { super(code); this.name = "CrudContractError"; }
}
function fail(code: CrudErrorCode): never { throw new CrudContractError(code); }

type Schema =
  | Readonly<{ type: "string"; maxLength: number; minLength?: number; pattern?: string; format?: "date-time"; enum?: readonly string[] }>
  | Readonly<{ type: "number" | "boolean" | "null" }>
  | Readonly<{ type: "integer"; minimum: number; maximum: number }>
  | Readonly<{ type: "object"; properties: Readonly<Record<string, Schema>>; required: readonly string[]; additionalProperties: false; minProperties?: number }>
  | Readonly<{ type: "array"; items: Schema; maxItems: number }>
  | Readonly<{ anyOf: readonly Schema[] }>;
type ObjectSchema = Extract<Schema, { type: "object" }>;
export interface CrudOperationDescriptor {
  readonly operationId: string;
  readonly resourceId: string;
  readonly action: CrudAction;
  readonly method: "get" | "post" | "patch" | "delete";
  readonly path: string;
  readonly input: ObjectSchema;
  readonly output: Schema;
  readonly authorization: Readonly<{
    ownership: ResourceOwnership; permission: string;
    authenticatedInstallationContext: true; requireTenantContext: boolean;
    rowAuthorization: true; fieldAuthorization: true;
    fieldIds: readonly string[]; relationshipTraversal: false;
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
  readonly fields: readonly Readonly<{ id: string; kind: FieldDefinition["type"]; required: boolean; values?: readonly string[] }>[];
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
const token: Schema = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" };
const cursor: Schema = { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
function fieldSchema(field: FieldDefinition): Schema {
  let schema: Schema;
  switch (field.type) {
    case "text": schema = { type: "string", maxLength: CRUD_LIMITS.textLength }; break;
    case "number": schema = { type: "number" }; break;
    case "boolean": schema = { type: "boolean" }; break;
    case "datetime":
      schema = { type: "string", maxLength: 24, format: "date-time",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$" }; break;
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
        (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) ||
        (schema.enum !== undefined && !schema.enum.includes(value))) return fail(code);
      // JS RegExp $ also accepts a final line break. Enforce the token alphabet.
      if (schema.pattern && schema.format !== "date-time" && /[^A-Za-z0-9_-]/.test(value)) return fail(code);
      if (schema.format === "date-time") {
        const date = new Date(value);
        if (!value.endsWith("Z") || Number.isNaN(date.getTime()) ||
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
    case "object": return "{ " + Object.entries(schema.properties).map(([key, value]) =>
      "readonly " + JSON.stringify(key) + (schema.required.includes(key) ? "" : "?") + ": " + typeSource(value) + ";").join(" ") + " }";
    case "array": return "ReadonlyArray<" + typeSource(schema.items) + ">";
    case "string": return schema.enum ? schema.enum.map(v => JSON.stringify(v)).join(" | ") : "string";
    case "integer": return "number";
    default: return schema.type;
  }
}
function openApi(operations: readonly CrudOperationDescriptor[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
  for (const op of operations) {
    const parameters: object[] = [];
    if (op.path.endsWith("/{id}")) parameters.push({ name: "id", in: "path", required: true, schema: token });
    if (op.requiresOptimisticConcurrency) parameters.push({ name: "X-Resource-Version", in: "header", required: true, schema: token,
      description: "Proposed opaque version token; runtime must atomically compare it before mutation." });
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
        "400": errorResponse("Invalid input"), "401": errorResponse("Authentication required"),
        "403": errorResponse("Authorization denied"), "404": errorResponse("Not found"),
        "409": errorResponse("Version conflict"), "429": errorResponse("Resource budget exceeded"),
        "503": errorResponse("Runtime unavailable"),
      },
      "x-vibress-runtime": op.runtime, "x-vibress-authorization": op.authorization, "x-vibress-cost": op.cost,
    };
  }
  return freeze({ openapi: "3.1.0", info: { title: "Vibress generated CRUD (offline)", version: "1.0.0",
    description: "Private design artifact; not an exposed API. Authentication and persistence are not implemented." },
    "x-vibress-runtime": "DISABLED", paths,
    components: { schemas: { Error: { type: "object", properties: { code: { type: "string", enum: ["INVALID_INPUT", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RESOURCE_LIMIT", "RUNTIME_UNAVAILABLE"] } }, required: ["code"], additionalProperties: false } }, securitySchemes: { futureBearer: { type: "http", scheme: "bearer", description: "Proposed only; no token validation provided." } } } });
}

/**
 * trustedConfiguration MUST come from reviewed internal configuration, not a request.
 * It binds scope and expected manifest digest, and explicitly selects exposed fields.
 * A digest proves consistency, not authenticity. No runtime capability is minted.
 * S01 exposes the same explicitly selected scalar fields for read/write. If a required
 * field is hidden (even with a default), create cannot be compiled safely; refuse.
 */
export function compileCrudContracts(manifestInput: unknown, trustedConfiguration: unknown) {
  const cfg = plainRecord(trustedConfiguration, ["applicationId", "installationId", "expectedManifestDigest", "exposure"], "INVALID_CONTRACT");
  let manifest: ReturnType<typeof parseSchemaManifest>;
  try { manifest = parseSchemaManifest(manifestInput); } catch { return fail("INVALID_CONTRACT"); }
  if (cfg.applicationId !== manifest.applicationId || cfg.installationId !== manifest.installationId ||
    cfg.expectedManifestDigest !== manifest.digest) return fail("INVALID_CONTRACT");
  const exposure = new Map<string, string[]>();
  for (const entry of denseArray(cfg.exposure, CRUD_LIMITS.resources, "INVALID_CONTRACT")) {
    const item = plainRecord(entry, ["resourceId", "fields"], "INVALID_CONTRACT");
    if (typeof item.resourceId !== "string" || blockedKeys.has(item.resourceId) || exposure.has(item.resourceId)) return fail("INVALID_CONTRACT");
    exposure.set(item.resourceId, identifiers(item.fields, CRUD_LIMITS.fieldsPerResource));
  }
  if (!exposure.size) return fail("INVALID_CONTRACT");
  const ops: CrudOperationDescriptor[] = [], admin: CrudAdminMetadata[] = [];
  for (const resourceId of [...exposure.keys()].sort()) {
    const resource = manifest.canonicalIr.resources.find(r => r.id === resourceId);
    if (!resource) return fail("INVALID_CONTRACT");
    const fieldIds = exposure.get(resourceId)!;
    const fields = fieldIds.map(id => {
      const field = resource.fields.find(f => f.id === id);
      if (!field || field.type === "relation") return fail("INVALID_CONTRACT");
      return field;
    });
    if (resource.fields.some(f => f.required && !fieldIds.includes(f.id))) return fail("INVALID_CONTRACT");
    const properties = Object.fromEntries(fields.map(f => [f.id, fieldSchema(f)]));
    const create = object(properties, fields.filter(f => f.required).map(f => f.id));
    const patch = object(properties, [], 1);
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
          rowAuthorization: true, fieldAuthorization: true, fieldIds, relationshipTraversal: false, enforcement: "REQUIRED_NOT_IMPLEMENTED" },
        cost: { maxRows: action === "list" ? CRUD_LIMITS.maxPageSize : 1, maxInputBytes: CRUD_LIMITS.maxInputBytes,
          maxOutputBytes: CRUD_LIMITS.maxOutputBytes, maxRelationDepth: 0, maxMutationBatch: 1,
          allowCount: false, allowFilter: false, allowSort: false, allowExport: false,
          requireRateLimit: true, requireQueryTimeout: true },
        requiresOptimisticConcurrency: concurrency, runtime: "DISABLED",
      });
    }
    admin.push({ resourceId, ownership: resource.ownership,
      fields: fields.map(f => ({ id: f.id, kind: f.type, required: f.required, ...(f.type === "enum" ? { values: [...f.values] } : {}) })),
      operations: ACTIONS.map(a => resourceId + "." + a), runtime: "DISABLED" });
  }
  const operations = freeze(ops);
  const generated = {
    contractVersion: CRUD_CONTRACT_VERSION, runtime: "DISABLED" as const, manifestDigest: manifest.digest,
    operations, admin: freeze(admin), openapi: openApi(operations),
    typescript: "// Offline declarations only. No transport or authorization implementation.\n" +
      "export type GeneratedErrorCode = \"INVALID_INPUT\" | \"UNAUTHENTICATED\" | \"FORBIDDEN\" | \"NOT_FOUND\" | \"CONFLICT\" | \"RESOURCE_LIMIT\" | \"RUNTIME_UNAVAILABLE\";\n" +
      "export interface GeneratedClient {\n" + operations.map(op =>
        "  " + JSON.stringify(op.operationId) + "(input: " + typeSource(op.input) + "): Promise<" + typeSource(op.output) + ">;").join("\n") + "\n}\n",
  };
  const digest = createHash("sha256").update(JSON.stringify(generated), "utf8").digest("hex");
  const descriptor = (id: string) => operations.find(op => op.operationId === id) ?? fail("INVALID_INPUT");
  return Object.freeze({
    ...generated, digest,
    validateInput(id: string, value: unknown): unknown { return checked(descriptor(id).input, value, "INVALID_INPUT", CRUD_LIMITS.maxInputBytes); },
    validateOutput(id: string, value: unknown): unknown {
      const op = operations.find(candidate => candidate.operationId === id) ?? fail("INVALID_OUTPUT");
      return checked(op.output, value, "INVALID_OUTPUT", CRUD_LIMITS.maxOutputBytes);
    },
    assertRuntimeAvailable(): never { return fail("RUNTIME_UNAVAILABLE"); },
  });
}
