import {
  StudioDocument,
  STUDIO_SCHEMA_NAME,
  CURRENT_STUDIO_VERSION,
  validateStudioDocument,
  migrateDocument,
  normalizeStudioDocument,
} from '@vibress/studio-core';

export function serializeStudioDocument(root: unknown): StudioDocument {
  const doc: StudioDocument = {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      lexicalVersion: '0.13.1',
    },
    // Canonicalization boundary: normalize legacy react-studio-card nodes to
    // studio-card so freshly saved documents only ever persist the canonical
    // representation.
    root: normalizeStudioDocument(
      root && typeof root === 'object' && 'type' in root ? root : { type: 'root', children: [] }
    ) as StudioDocument['root'],
  };

  return validateStudioDocument(doc);
}

export function deserializeStudioDocument(input: unknown): StudioDocument {
  return migrateDocument(input);
}
