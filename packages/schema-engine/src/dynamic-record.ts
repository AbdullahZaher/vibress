// Bounded dynamic record storage profile. This is a versioned contract, not a
// general JSONB store: records carry an opaque revision identity, every key is
// declared, and budget violations are refused before SQL. PostgreSQL enforces
// only the object shape and byte size; depth, key count, declared fields,
// value types and per-tenant record counts are trusted-writer guarantees.
import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { enforceBoundedJson, type JsonMeasurement } from "./json-bounds";

export interface DynamicRecordFieldDefinition {
  readonly id: string;
  readonly type: "text" | "integer" | "number" | "boolean" | "date" | "datetime" | "json";
  readonly required: boolean;
  readonly maxLength?: number;
}

export interface DynamicRecordProfile {
  readonly fields: readonly DynamicRecordFieldDefinition[];
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxRecordsPerTenant: number;
}

export const DYNAMIC_RECORD_PROFILE_VERSION = 1 as const;

export const DYNAMIC_RECORD_ENFORCEMENT = Object.freeze({
  shape: "POSTGRES_CHECK",
  bytes: "POSTGRES_CHECK_AND_APPLICATION",
  fields: "APPLICATION",
  types: "APPLICATION",
  depth: "APPLICATION",
  keys: "APPLICATION",
  recordCount: "APPLICATION_TRANSACTION",
} as const);

export const DYNAMIC_RECORD_QUERY_POLICY = Object.freeze({
  getById: true,
  orderBy: Object.freeze(["id"] as const),
  filters: Object.freeze([] as const),
  indexes: "PRIMARY_KEY_ONLY" as const,
  maxLimit: 100,
});

const refuse = (reason: string): never => {
  throw Error("DYNAMIC_RECORD_REFUSED:" + reason);
};
const refuseQuery = (reason: string): never => {
  throw Error("DYNAMIC_RECORD_QUERY_REFUSED:" + reason);
};

const intent = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const FIELD_ID = /^[a-z][a-z0-9_]{0,62}$/;
const FIELD_TYPES = new Set(["text", "integer", "number", "boolean", "date", "datetime", "json"]);

/** Manifest-facing normalization; bounds mirror the canonical IR parser. */
export function normalizeDynamicRecordProfile(value: unknown): DynamicRecordProfile {
  if (!value || typeof value !== "object" || Array.isArray(value) || nodeTypes.isProxy(value)) {
    return refuse("PROFILE");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["fields", "maxBytes", "maxDepth", "maxKeys", "maxRecordsPerTenant"];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowed.includes(key)) return refuse("PROFILE_KEY");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return refuse("PROFILE_KEY");
  }
  const rawFields = input.fields;
  if (!Array.isArray(rawFields) || rawFields.length < 1 || rawFields.length > 32) return refuse("PROFILE_FIELDS");
  const fields: DynamicRecordFieldDefinition[] = [];
  for (const entry of rawFields) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || nodeTypes.isProxy(entry)) return refuse("PROFILE_FIELD");
    const field = entry as Record<string, unknown>;
    for (const key of Reflect.ownKeys(field)) {
      if (typeof key !== "string" || !["id", "type", "required", "maxLength"].includes(key)) return refuse("PROFILE_FIELD_KEY");
      const descriptor = Object.getOwnPropertyDescriptor(field, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return refuse("PROFILE_FIELD_KEY");
    }
    if (typeof field.id !== "string" || !FIELD_ID.test(field.id)) return refuse("PROFILE_FIELD_ID");
    if (typeof field.type !== "string" || !FIELD_TYPES.has(field.type)) return refuse("PROFILE_FIELD_TYPE");
    if (typeof field.required !== "boolean") return refuse("PROFILE_FIELD_REQUIRED");
    if (field.maxLength !== undefined) {
      if (field.type !== "text" || !intent(field.maxLength, 1, 10000)) return refuse("PROFILE_FIELD_LENGTH");
    }
    fields.push(Object.freeze({
      id: field.id,
      type: field.type as DynamicRecordFieldDefinition["type"],
      required: field.required,
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength as number }),
    }));
  }
  fields.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(fields.map((field) => field.id)).size !== fields.length) return refuse("PROFILE_FIELD_DUPLICATE");
  if (!intent(input.maxBytes, 1, 65536)) return refuse("PROFILE_MAX_BYTES");
  if (!intent(input.maxDepth, 1, 8)) return refuse("PROFILE_MAX_DEPTH");
  if (!intent(input.maxKeys, 1, 64)) return refuse("PROFILE_MAX_KEYS");
  if (!intent(input.maxRecordsPerTenant, 1, 100000)) return refuse("PROFILE_MAX_RECORDS");
  return Object.freeze({
    fields: Object.freeze(fields),
    maxBytes: input.maxBytes,
    maxDepth: input.maxDepth,
    maxKeys: input.maxKeys,
    maxRecordsPerTenant: input.maxRecordsPerTenant,
  });
}

export function dynamicRecordRevision(profile: DynamicRecordProfile): string {
  // Declared field order is not identity: normalize so a profile and its
  // canonical manifest projection always bind to the same revision.
  const canonical = normalizeDynamicRecordProfile(profile);
  const body = [
    "VIBRESS-DYNAMIC-RECORD-V1",
    canonical.fields.map((field) => [field.id, field.type, field.required, field.maxLength ?? null]),
    canonical.maxBytes,
    canonical.maxDepth,
    canonical.maxKeys,
    canonical.maxRecordsPerTenant,
  ];
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

export interface DynamicRecordEvidence extends JsonMeasurement {
  readonly canonical: string;
  readonly revision: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return refuse("VALUE");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

function validField(field: DynamicRecordFieldDefinition, value: unknown): void {
  switch (field.type) {
    case "text":
      if (typeof value !== "string" || value.includes("\u0000") ||
          (field.maxLength !== undefined && value.length > field.maxLength)) return refuse("FIELD_TEXT");
      return;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value) ||
          value < -2147483648 || value > 2147483647) return refuse("FIELD_INTEGER");
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return refuse("FIELD_NUMBER");
      return;
    case "boolean":
      if (typeof value !== "boolean") return refuse("FIELD_BOOLEAN");
      return;
    case "date":
      if (typeof value !== "string" || !validDate(value)) return refuse("FIELD_DATE");
      return;
    case "datetime":
      if (typeof value !== "string" || !DATETIME.test(value) || !Number.isFinite(Date.parse(value))) return refuse("FIELD_DATETIME");
      return;
    case "json":
      return;
  }
}

/**
 * Trusted-writer validation for one dynamic record. Returns canonical bytes,
 * measured budgets and the profile revision the record must be bound to.
 */
export function validateDynamicRecord(profile: DynamicRecordProfile, input: unknown): DynamicRecordEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input) || nodeTypes.isProxy(input)) return refuse("RECORD");
  const record = input as Record<string, unknown>;
  const declared = new Map(profile.fields.map((field) => [field.id, field]));
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !declared.has(key)) return refuse("UNKNOWN_FIELD");
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return refuse("RECORD");
  }
  for (const field of profile.fields) {
    if (field.required && !Object.prototype.hasOwnProperty.call(record, field.id)) return refuse("MISSING_FIELD");
    if (!Object.prototype.hasOwnProperty.call(record, field.id)) continue;
    const value = record[field.id];
    if (value === null) return refuse("NULL_FIELD");
    validField(field, value);
  }
  let measured: JsonMeasurement;
  try {
    measured = enforceBoundedJson(
      { maxBytes: profile.maxBytes, maxDepth: profile.maxDepth, maxKeys: profile.maxKeys },
      record,
    );
  } catch {
    return refuse("BOUND");
  }
  return {
    ...measured,
    canonical: canonicalJson(record),
    revision: dynamicRecordRevision(profile),
  };
}

function hasExactKeys(value: unknown, allowed: readonly string[], required: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => typeof key === "string" && allowed.includes(key));
}

/**
 * The only supported access plan. Filtering or ordering on payload content is
 * refused because the V1 profile creates no GIN or expression index and does
 * not perform sequential scans over unbounded tenant data.
 */
export function assertDynamicRecordQuery(query: unknown): void {
  if (!query || typeof query !== "object" || Array.isArray(query)) return refuseQuery("SHAPE");
  if (!hasExactKeys(query, ["limit", "order", "after"], ["limit"])) return refuseQuery("SHAPE");
  const input = query as { limit?: unknown; order?: unknown; after?: unknown };
  if (!intent(input.limit, 1, DYNAMIC_RECORD_QUERY_POLICY.maxLimit)) return refuseQuery("LIMIT");
  if (input.order !== undefined && input.order !== "id") return refuseQuery("ORDER");
  if (input.after !== undefined && typeof input.after !== "string") return refuseQuery("CURSOR");
}
