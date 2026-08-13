import { z } from 'zod';

export const STUDIO_SCHEMA_NAME = 'vibress-studio';
export const CURRENT_STUDIO_VERSION = 1;

export interface StudioDocument {
  schema: 'vibress-studio';
  version: number;
  editor?: {
    lexicalVersion?: string;
  };
  root: {
    type: 'root';
    children: unknown[];
    [key: string]: unknown;
  };
}

export const StudioDocumentSchema = z.object({
  schema: z.literal('vibress-studio'),
  version: z.number().int().positive(),
  editor: z
    .object({
      lexicalVersion: z.string().optional(),
    })
    .optional(),
  root: z.object({
    type: z.literal('root'),
    children: z.array(z.unknown()),
  }).passthrough(),
});

export function validateStudioDocument(doc: unknown): StudioDocument {
  if (!doc || typeof doc !== 'object') {
    throw new Error('INVALID_STUDIO_DOCUMENT: Document must be an object');
  }

  const result = StudioDocumentSchema.safeParse(doc);
  if (!result.success) {
    throw new Error(`INVALID_STUDIO_DOCUMENT: ${result.error.message}`);
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
      lexicalVersion: '0.13.1',
    },
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: '',
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
export const LEGACY_CARD_NODE_TYPE = 'react-studio-card';
export const CANONICAL_CARD_NODE_TYPE = 'studio-card';

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
  if (rawDoc && typeof rawDoc === 'object') {
    const obj = rawDoc as Record<string, unknown>;
    if (obj.type === LEGACY_CARD_NODE_TYPE) {
      return {
        ...obj,
        type: CANONICAL_CARD_NODE_TYPE,
        children: obj.children ? normalizeStudioDocument(obj.children) : obj.children,
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

export function createDefaultStudioDocument(text = ''): StudioDocument {
  if (!text) return createEmptyStudioDocument();

  return {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      lexicalVersion: '0.13.1',
    },
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: text,
              format: 0,
              detail: 0,
              mode: 'normal',
              style: '',
              version: 1,
            },
          ],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  };
}

export function migrateDocument(rawDoc: unknown): StudioDocument {
  if (!rawDoc) {
    return createEmptyStudioDocument();
  }

  // Handle legacy string content from Batch 2
  if (typeof rawDoc === 'string') {
    try {
      const parsed = JSON.parse(rawDoc);
      return migrateDocument(parsed);
    } catch {
      return createDefaultStudioDocument(rawDoc);
    }
  }

  // Handle legacy object from Batch 2 (e.g. { version: 1, text: "..." })
  if (typeof rawDoc === 'object' && rawDoc !== null) {
    const obj = rawDoc as Record<string, unknown>;

    // If it is already a valid Studio document, normalize legacy card nodes
    // to the canonical representation (react-studio-card → studio-card).
    if (obj.schema === 'vibress-studio' && obj.root) {
      return validateStudioDocument(normalizeStudioDocument(rawDoc));
    }

    // Legacy Batch 2 format: { text: "..." } or { root: ... } without schema envelope
    if (typeof obj.text === 'string') {
      return createDefaultStudioDocument(obj.text);
    }

    if (obj.root && typeof obj.root === 'object') {
      return {
        schema: STUDIO_SCHEMA_NAME,
        version: CURRENT_STUDIO_VERSION,
        editor: { lexicalVersion: '0.13.1' },
        root: normalizeStudioDocument(obj.root as StudioDocument['root']),
      };
    }
  }

  return createEmptyStudioDocument();
}
