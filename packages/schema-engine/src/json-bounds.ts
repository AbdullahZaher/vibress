// Trusted-write guard for bounded JSON fields. PostgreSQL enforces the storage
// byte bound with a CHECK; container depth and key count have no database
// predicate (that would require a privileged validation routine), so every
// trusted writer must enforce them here before the value reaches SQL.
const refuse = (reason: string): never => {
  throw Error("JSON_BOUND_REFUSED:" + reason);
};

export interface BoundedJsonField {
  maxBytes?: number;
  maxDepth?: number;
  maxKeys?: number;
}
export interface JsonMeasurement {
  bytes: number;
  depth: number;
  keys: number;
}
export const JSON_BOUND_ENFORCEMENT = Object.freeze({
  bytes: "POSTGRES_CHECK_AND_APPLICATION",
  depth: "APPLICATION",
  keys: "APPLICATION",
} as const);

const intent = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

function bounds(field: BoundedJsonField) {
  if (field.maxBytes === undefined) return refuse("CONFIG");
  const maxBytes = field.maxBytes, maxDepth = field.maxDepth ?? 8, maxKeys = field.maxKeys ?? 1000;
  // Ranges mirror the manifest parser; an unparsed caller cannot widen them.
  if (!intent(maxBytes, 1, 1000000) || !intent(maxDepth, 1, 32) || !intent(maxKeys, 1, 10000)) return refuse("CONFIG");
  return { maxBytes, maxDepth, maxKeys };
}

// Strict JSON walk: rejects anything JSON.stringify would silently coerce
// (undefined, functions, bigints, non-finite numbers, holes, accessors),
// non-plain objects (Date, Map, class instances, toJSON carriers) and cycles.
function walk(value: unknown, depth: number, seen: Set<object>, stats: JsonMeasurement): void {
  if (depth > 32) return refuse("DEPTH");
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) refuse("VALUE");
      return;
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      return refuse("VALUE");
    case "object":
      break;
  }
  if (value === null) return;
  if (seen.has(value)) return refuse("VALUE");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return refuse("VALUE");
      if (value.length > 100000) return refuse("KEYS");
      if (value.length > 0 && Object.keys(value).length !== value.length) return refuse("VALUE");
      stats.depth = Math.max(stats.depth, depth);
      for (const item of value) walk(item, depth + 1, seen, stats);
      return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return refuse("VALUE");
    if (Object.getOwnPropertySymbols(value).some((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return refuse("VALUE");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) return refuse("VALUE");
      stats.keys += 1;
      if (stats.keys > 10000) return refuse("KEYS");
      walk(descriptor.value, depth + 1, seen, stats);
    }
    stats.depth = Math.max(stats.depth, depth);
  } finally {
    seen.delete(value);
  }
}

export function measureBoundedJson(value: unknown): JsonMeasurement {
  const stats: JsonMeasurement = { bytes: 0, depth: 0, keys: 0 };
  walk(value, 1, new Set(), stats);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return refuse("VALUE");
  }
  if (serialized === undefined) return refuse("VALUE");
  stats.bytes = Buffer.byteLength(serialized, "utf8");
  return stats;
}

export function enforceBoundedJson(field: BoundedJsonField, value: unknown): JsonMeasurement {
  const limit = bounds(field), measured = measureBoundedJson(value);
  if (measured.bytes > limit.maxBytes) return refuse("BYTES");
  if (measured.depth > limit.maxDepth) return refuse("DEPTH");
  if (measured.keys > limit.maxKeys) return refuse("KEYS");
  return measured;
}
