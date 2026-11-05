import {
  StudioDocument,
  STUDIO_SCHEMA_NAME,
  CURRENT_STUDIO_VERSION,
  validateStudioDocument,
  migrateDocument,
  normalizeStudioDocument,
  checkDocumentResourceLimits,
  type DocumentResourceLimits,
  StudioMigrationError,
} from "@vibress/studio-core";

export function serializeStudioDocument(root: unknown, limits?: DocumentResourceLimits, sourceDocument?: StudioDocument): StudioDocument {
  if (sourceDocument && sourceDocument.version !== CURRENT_STUDIO_VERSION) {
    throw new StudioMigrationError("A future document cannot be serialized as v1.", sourceDocument, "UNSUPPORTED_DOCUMENT");
  }
  if (sourceDocument) { checkDocumentResourceLimits(sourceDocument, limits); validateStudioDocument(sourceDocument); }
  // Never normalize an unbounded or accessor-based object recursively.
  const source = root === null || root === undefined
    ? { type: "root", children: [] } : root;
  checkDocumentResourceLimits(source, limits);
  const doc: StudioDocument = {
    ...sourceDocument,
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
      ...sourceDocument?.editor,
      lexicalVersion: "0.13.1",
    },
    // Canonicalization boundary: normalize legacy react-studio-card nodes to
    // studio-card so freshly saved documents only ever persist the canonical
    // representation.
    root: normalizeStudioDocument(
      source,
    ) as StudioDocument["root"],
  };

  checkDocumentResourceLimits(doc, limits);
  return validateStudioDocument(doc);
}

export function deserializeStudioDocument(input: unknown, limits?: DocumentResourceLimits): StudioDocument {
  return migrateDocument(input, limits);
}
