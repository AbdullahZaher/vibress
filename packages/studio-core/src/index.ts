import { z } from "zod";
import {
  checkDocumentResourceLimits,
  StudioMigrationError,
  type DocumentResourceLimits,
} from "./resource-limits";

export {
  checkDocumentResourceLimits,
  getDocumentUtf8ByteLength,
  resolveDocumentResourceLimits,
  DEFAULT_DOCUMENT_RESOURCE_LIMITS,
  StudioMigrationError,
} from "./resource-limits";
export type { DocumentResourceLimits } from "./resource-limits";

export const STUDIO_SCHEMA_NAME = "vibress-studio";
export const CURRENT_STUDIO_VERSION = 1;

export interface StudioDocument {
  schema: "vibress-studio";
  version: number;
  editor?: {
    lexicalVersion?: string;
  };
  root: {
    type: "root";
    children: unknown[];
    [key: string]: unknown;
  };
}

export const StudioDocumentSchema = z.object({
  schema: z.literal("vibress-studio"),
  version: z.number().int().positive(),
  editor: z
    .object({
      lexicalVersion: z.string().optional(),
    })
    .optional(),
  root: z
    .object({
      type: z.literal("root"),
      children: z.array(z.unknown()),
    })
    .passthrough(),
});

export function validateStudioDocument(doc: unknown): StudioDocument {
  if (!doc || typeof doc !== "object") {
    throw new StudioMigrationError("INVALID_STUDIO_DOCUMENT: Document must be an object", doc, "INVALID_DOCUMENT");
  }

  const result = StudioDocumentSchema.safeParse(doc);
  if (!result.success) {
    throw new StudioMigrationError(`INVALID_STUDIO_DOCUMENT: ${result.error.message}`, doc, "INVALID_DOCUMENT");
  }

  return result.data as StudioDocument;
}

export function isValidStudioDocument(doc: unknown): doc is StudioDocument {
  try {
    validateStudioDocument(doc);
    return true;
  } catch {
    return false;
  }
}

export function createEmptyStudioDocument(): StudioDocument {
  return {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      lexicalVersion: "0.13.1",
    },
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [],
          direction: null,
          format: "",
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

/**
 * LEGACY_CARD_NODE_TYPE and CANONICAL_CARD_NODE_TYPE
 *
 * The React/Lexical editor historically serialized its interactive card node
 * as `react-studio-card`. The canonical persisted/public schema uses
 * `studio-card`. The single normalization layer below converts legacy nodes
 * to canonical nodes at every read boundary, so downstream systems only ever
 * need to understand `studio-card`.
 */
export const LEGACY_CARD_NODE_TYPE = "react-studio-card";
export const CANONICAL_CARD_NODE_TYPE = "studio-card";

/**
 * Recursively normalize a Studio document to the canonical representation:
 *   react-studio-card → studio-card
 * preserving cardType, cardData, version, children, and every other field.
 * Canonical documents pass through unchanged. Unknown nodes are preserved
 * untouched (the renderer decides how to handle unknown types).
 */
export function normalizeStudioDocument<T>(rawDoc: T): T {
  if (Array.isArray(rawDoc)) {
    return rawDoc.map((item) => normalizeStudioDocument(item)) as unknown as T;
  }
  if (rawDoc && typeof rawDoc === "object") {
    const obj = rawDoc as Record<string, unknown>;
    if (obj.type === LEGACY_CARD_NODE_TYPE) {
      return {
        ...obj,
        type: CANONICAL_CARD_NODE_TYPE,
        children: obj.children
          ? normalizeStudioDocument(obj.children)
          : obj.children,
      } as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = normalizeStudioDocument(value);
    }
    return out as unknown as T;
  }
  return rawDoc;
}

export function createDefaultStudioDocument(text = ""): StudioDocument {
  if (!text) return createEmptyStudioDocument();

  return {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      lexicalVersion: "0.13.1",
    },
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: text,
              format: 0,
              detail: 0,
              mode: "normal",
              style: "",
              version: 1,
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

/** Historical content used root: {} or root: { children: [...] }. Restore only
 * unambiguous structural fields; an explicit type or other incomplete payload
 * must still fail validation with its original content available for recovery. */
function migrateLegacyRoot(root: unknown): unknown {
  if (!root || typeof root !== "object" || Array.isArray(root) || "type" in root) return root;
  if ("children" in root && Array.isArray(root.children)) return { ...root, type: "root" };
  if (Object.keys(root).length === 0) return { type: "root", children: [] };
  return root;
}

function validateMigratedDocument(candidate: unknown, original: unknown, limits?: DocumentResourceLimits): StudioDocument {
  try {
    checkDocumentResourceLimits(candidate, limits);
    return validateStudioDocument(candidate);
  } catch (error) {
    if (error instanceof StudioMigrationError) {
      throw new StudioMigrationError(error.message, original, error.code);
    }
    throw error;
  }
}

/** Migration never silently turns a non-null unsupported persisted record into
 * an empty editor document. Keep the input on StudioMigrationError for recovery.
 */
export function migrateDocument(rawDoc: unknown, limits?: DocumentResourceLimits): StudioDocument {
  if (rawDoc === null || rawDoc === undefined) return createEmptyStudioDocument();
  checkDocumentResourceLimits(rawDoc, limits);

  if (typeof rawDoc === "string") {
    if (!rawDoc.trim()) return createEmptyStudioDocument();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDoc);
    } catch {
      if (rawDoc.trimStart().startsWith("{") || rawDoc.trimStart().startsWith("[")) {
        throw new StudioMigrationError("Persisted document contains malformed JSON.", rawDoc, "CORRUPTED_DOCUMENT");
      }
      const legacyText = createDefaultStudioDocument(rawDoc);
      checkDocumentResourceLimits(legacyText, limits);
      return legacyText;
    }
    if (parsed && typeof parsed === "object") {
      try { return migrateDocument(parsed, limits); }
      catch (error) {
        if (error instanceof StudioMigrationError) {
          throw new StudioMigrationError(error.message, rawDoc, error.code);
        }
        throw error;
      }
    }
    const text = createDefaultStudioDocument(typeof parsed === "string" ? parsed : rawDoc);
    checkDocumentResourceLimits(text, limits);
    return text;
  }

  if (typeof rawDoc !== "object" || Array.isArray(rawDoc)) {
    throw new StudioMigrationError("Unsupported Studio document payload.", rawDoc, "UNSUPPORTED_DOCUMENT");
  }
  const obj = rawDoc as Record<string, unknown>;
  if (obj.schema === STUDIO_SCHEMA_NAME) {
    if (obj.version !== CURRENT_STUDIO_VERSION) {
      throw new StudioMigrationError("Document version is not supported by this editor.", rawDoc, "UNSUPPORTED_DOCUMENT");
    }
    if (!obj.root) {
      throw new StudioMigrationError("Studio document is missing its root.", rawDoc, "INVALID_DOCUMENT");
    }
    const normalized = normalizeStudioDocument({ ...obj, root: migrateLegacyRoot(obj.root) });
    return validateMigratedDocument(normalized, rawDoc, limits);
  }

  if ("schema" in obj) {
    throw new StudioMigrationError("Unrecognized document schema.", rawDoc, "UNSUPPORTED_DOCUMENT");
  }

  if (typeof obj.text === "string") {
    const legacyText = createDefaultStudioDocument(obj.text);
    checkDocumentResourceLimits(legacyText, limits);
    return legacyText;
  }
  if (obj.root && typeof obj.root === "object" && !Array.isArray(obj.root)) {
    const legacy = {
      schema: STUDIO_SCHEMA_NAME,
      version: CURRENT_STUDIO_VERSION,
      editor: { lexicalVersion: "0.13.1" },
      root: normalizeStudioDocument(obj.version === undefined || obj.version === CURRENT_STUDIO_VERSION
        ? migrateLegacyRoot(obj.root) : obj.root),
    };
    return validateMigratedDocument(legacy, rawDoc, limits);
  }

  throw new StudioMigrationError("Unrecognized Studio document. Original input has been preserved.", rawDoc, "UNSUPPORTED_DOCUMENT");
}
