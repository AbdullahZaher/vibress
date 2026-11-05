/** Shared Studio v1 admission policy for stored, imported, and emitted data. */
export interface DocumentResourceLimits {
  maxSizeBytes?: number;
  maxNodeCount?: number;
  maxDepth?: number;
}

export const DEFAULT_DOCUMENT_RESOURCE_LIMITS: Required<DocumentResourceLimits> = {
  maxSizeBytes: 5 * 1024 * 1024,
  maxNodeCount: 50_000,
  maxDepth: 64,
};

export class StudioMigrationError extends Error {
  readonly rawDocument: unknown;
  readonly code: "RESOURCE_LIMIT_EXCEEDED" | "INVALID_DOCUMENT" | "UNSUPPORTED_DOCUMENT" | "CORRUPTED_DOCUMENT";

  constructor(
    message: string,
    rawDocument: unknown,
    code: StudioMigrationError["code"] = "INVALID_DOCUMENT",
  ) {
    super(message);
    this.name = "StudioMigrationError";
    this.rawDocument = rawDocument;
    this.code = code;
  }
}

export function resolveDocumentResourceLimits(limits: DocumentResourceLimits = {}): Required<DocumentResourceLimits> {
  const fallback = DEFAULT_DOCUMENT_RESOURCE_LIMITS;
  const positive = (value: number | undefined, defaultValue: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 1
      ? Math.floor(value) : defaultValue;
  return {
    maxSizeBytes: positive(limits.maxSizeBytes, fallback.maxSizeBytes),
    maxNodeCount: positive(limits.maxNodeCount, fallback.maxNodeCount),
    maxDepth: positive(limits.maxDepth, fallback.maxDepth),
  };
}

export function getDocumentUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Validate without invoking getters, toJSON or user-defined prototypes.
 * AST limits count only root/children nodes, not arbitrary card metadata.
 * The exact size check uses the JSON bytes which persistence would emit.
 */
export function checkDocumentResourceLimits(rawDocument: unknown, limits?: DocumentResourceLimits): void {
  const policy = resolveDocumentResourceLimits(limits);
  if (typeof rawDocument === "string") {
    if (rawDocument.length > policy.maxSizeBytes ||
        getDocumentUtf8ByteLength(rawDocument) > policy.maxSizeBytes) {
      throw new StudioMigrationError("Document exceeds the maximum UTF-8 size.", rawDocument, "RESOURCE_LIMIT_EXCEEDED");
    }
    return;
  }

  let nodes = 0;
  const ancestors = new Set<object>();
  const fail = (message: string, code: StudioMigrationError["code"]) => {
    throw new StudioMigrationError(message, rawDocument, code);
  };
  function scan(value: unknown, depth: number, isAst: boolean): void {
    if (depth > policy.maxDepth) fail("Document exceeds the maximum nesting depth.", "RESOURCE_LIMIT_EXCEEDED");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (value.length > policy.maxSizeBytes) fail("Document contains an oversized string.", "RESOURCE_LIMIT_EXCEEDED");
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null) {
      fail("Document contains a value that cannot be safely serialized as JSON.", "INVALID_DOCUMENT");
    }
    const object = value as object;
    if (ancestors.has(object)) fail("Cyclic Studio documents cannot be serialized.", "INVALID_DOCUMENT");
    const proto = Object.getPrototypeOf(object);
    if (!Array.isArray(object) && proto !== Object.prototype && proto !== null) {
      fail("Studio documents must contain plain JSON objects.", "INVALID_DOCUMENT");
    }
    ancestors.add(object);
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index++) {
        const property = Object.getOwnPropertyDescriptor(object, String(index));
        if (!property || !("value" in property)) {
          fail("Sparse or accessor arrays are not supported.", "INVALID_DOCUMENT");
        }
        scan(property.value, depth + 1, isAst);
      }
    } else {
      const record = object as Record<string, unknown>;
      if (isAst && typeof record.type === "string") {
        nodes++;
        if (nodes > policy.maxNodeCount) fail("Document exceeds maximum AST node count.", "RESOURCE_LIMIT_EXCEEDED");
      }
      for (const key of Object.keys(record)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          fail("Unsafe document object property.", "INVALID_DOCUMENT");
        }
        const property = Object.getOwnPropertyDescriptor(record, key);
        if (!property || !("value" in property)) {
          fail("Accessor properties are not supported.", "INVALID_DOCUMENT");
        }
        if (property.value === undefined) continue; // JSON.stringify omits optional properties.
        scan(property.value, depth + 1,
          (key === "root" && !isAst) || (key === "children" && isAst));
      }
    }
    ancestors.delete(object);
  }
  scan(rawDocument, 1, Boolean(rawDocument && typeof rawDocument === "object" &&
    !Array.isArray(rawDocument) && "type" in rawDocument));
  const serialized = JSON.stringify(rawDocument);
  if (typeof serialized !== "string") fail("Document has no JSON representation.", "INVALID_DOCUMENT");
  if (serialized.length > policy.maxSizeBytes ||
      getDocumentUtf8ByteLength(serialized) > policy.maxSizeBytes) {
    fail("Document exceeds the maximum serialized UTF-8 size.", "RESOURCE_LIMIT_EXCEEDED");
  }
}
