import {
  StudioDocument,
  STUDIO_SCHEMA_NAME,
  CURRENT_STUDIO_VERSION,
  validateStudioDocument,
  migrateDocument,
  normalizeStudioDocument,
  checkDocumentResourceLimits,
  type DocumentResourceLimits,
} from "@vibress/studio-core";

export function serializeStudioDocument(root: unknown, limits?: DocumentResourceLimits): StudioDocument {
  // Never normalize an unbounded or accessor-based object recursively.
  const source = root === null || root === undefined
    ? { type: "root", children: [] } : root;
  checkDocumentResourceLimits(source, limits);
  const doc: StudioDocument = {
    schema: STUDIO_SCHEMA_NAME,
    version: CURRENT_STUDIO_VERSION,
    editor: {
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
