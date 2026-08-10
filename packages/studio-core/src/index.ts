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

    // If it is already a valid Studio document
    if (obj.schema === 'vibress-studio' && obj.root) {
      return validateStudioDocument(rawDoc);
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
        root: obj.root as StudioDocument['root'],
      };
    }
  }

  return createEmptyStudioDocument();
}
