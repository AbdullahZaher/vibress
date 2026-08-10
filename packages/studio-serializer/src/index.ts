import {
  StudioDocument,
  STUDIO_SCHEMA_NAME,
  CURRENT_STUDIO_VERSION,
  validateStudioDocument,
  migrateDocument,
} from '@vibress/studio-core';

export function serializeStudioDocument(root: unknown): StudioDocument {
  const doc: StudioDocument = {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      lexicalVersion: '0.13.1',
    },
    root: (root && typeof root === 'object' && 'type' in root ? root : { type: 'root', children: [] }) as StudioDocument['root'],
  };

  return validateStudioDocument(doc);
}

export function deserializeStudioDocument(input: unknown): StudioDocument {
  return migrateDocument(input);
}
