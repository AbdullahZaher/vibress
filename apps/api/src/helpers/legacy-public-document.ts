import { StudioMigrationError, type StudioDocument } from "@vibress/studio-core";

/**
 * Read-only adapter for the historical ProseMirror/Tiptap JSON fixtures stored
 * by earlier publishing paths. This is deliberately NOT part of migrateDocument:
 * unsupported editable content must remain recoverable rather than being
 * silently converted into a lossy Lexical document.
 *
 * The original database JSON is never mutated or replaced. Callers use this
 * projection only to render an API response.
 */
export function projectLegacyPublicDocument(source: unknown): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const root = source as Record<string, unknown>;
  if (root.type !== "doc") return source;

  const reject = (reason: string): never => {
    throw new StudioMigrationError(
      `Unsupported legacy published document: ${reason}. Original content was preserved.`,
      source,
      "UNSUPPORTED_DOCUMENT",
    );
  };
  const onlyKeys = (node: Record<string, unknown>, allowed: readonly string[]): boolean =>
    Object.keys(node).every((key) => allowed.includes(key));

  if (!Array.isArray(root.content) || !onlyKeys(root, ["type", "content"])) {
    return reject("invalid root or unknown root metadata");
  }

  const convertText = (node: unknown): Record<string, unknown> => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return reject("invalid text node");
    const item = node as Record<string, unknown>;
    if (item.type !== "text" || typeof item.text !== "string" ||
        !onlyKeys(item, ["type", "text"])) {
      // Unrecognized marks/attributes are not thrown away: retain the source
      // and require an explicit supported migration before displaying them.
      return reject("unsupported text node or formatting");
    }
    return {
      type: "text",
      version: 1,
      text: item.text,
      format: 0,
      detail: 0,
      mode: "normal",
      style: "",
    };
  };

  const children = root.content.map((node: unknown) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return reject("invalid block");
    const block = node as Record<string, unknown>;
    if (block.type !== "paragraph" || !onlyKeys(block, ["type", "content"])) {
      return reject("unsupported block type or metadata");
    }
    if (block.content !== undefined && !Array.isArray(block.content)) return reject("invalid paragraph children");
    const inline = (block.content ?? []) as unknown[];
    return {
      type: "paragraph",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: inline.map(convertText),
    };
  });

  return {
    schema: "vibress-studio",
    version: 1,
    editor: { lexicalVersion: "0.13.1" },
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children,
    },
  } satisfies StudioDocument;
}
