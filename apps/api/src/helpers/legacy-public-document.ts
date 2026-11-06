/**
 * Read-only publication adapter for older TipTap/ProseMirror JSON stored before
 * Studio v1. It does NOT migrate or rewrite persisted content or editor drafts.
 * Unsupported nodes/marks fail closed so no partial rich content is presented as
 * a complete conversion. Studio's final HTML sanitizer still owns XSS safety.
 */
import { checkDocumentResourceLimits } from "@vibress/studio-core";
import { renderStudioDocumentToPlainText } from "@vibress/studio-renderer";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid historical publication node");
  }
  return value as JsonRecord;
}

function legacyChildren(node: JsonRecord): unknown[] {
  if (node.content === undefined || node.content === null) return [];
  if (!Array.isArray(node.content)) throw new Error("Invalid historical publication children");
  return node.content.map(convertLegacyNode);
}

function convertLegacyNode(input: unknown): unknown {
  const node = record(input);
  const attrs = node.attrs === undefined || node.attrs === null ? {} : record(node.attrs);

  if (node.type === "text") {
    if (typeof node.text !== "string") throw new Error("Invalid historical text");
    let format = 0;
    let link: string | null = null;
    const marks = node.marks ?? [];
    if (!Array.isArray(marks)) throw new Error("Invalid historical text marks");
    for (const rawMark of marks) {
      const mark = record(rawMark);
      switch (mark.type) {
        case "bold": format |= 1; break;
        case "italic": format |= 2; break;
        case "strike": format |= 4; break;
        case "underline": format |= 8; break;
        case "code": format |= 16; break;
        case "link": {
          const markAttrs = record(mark.attrs);
          if (typeof markAttrs.href !== "string") throw new Error("Invalid historical link");
          link = markAttrs.href;
          break;
        }
        default: throw new Error("Unsupported historical text mark");
      }
    }
    const textNode = { type: "text", version: 1, text: node.text, format };
    return link === null ? textNode : { type: "link", version: 1, url: link, children: [textNode] };
  }

  const children = legacyChildren(node);
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", version: 1, children };
    case "heading": {
      const level = attrs.level ?? 2;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 6) {
        throw new Error("Unsupported historical heading level");
      }
      return { type: "heading", version: 1, tag: `h${level}`, children };
    }
    case "blockquote":
      return { type: "quote", version: 1, children };
    case "bulletList":
      return { type: "list", version: 1, listType: "bullet", children };
    case "orderedList": {
      const start = attrs.start ?? 1;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) {
        throw new Error("Invalid historical ordered list start");
      }
      return { type: "list", version: 1, listType: "number", start, children };
    }
    case "listItem":
      return { type: "listitem", version: 1, children };
    case "codeBlock":
      return { type: "code", version: 1,
        ...(typeof attrs.language === "string" ? { language: attrs.language } : {}),
        children };
    default:
      throw new Error(`Unsupported historical publication node: ${String(node.type)}`);
  }
}

export function toRenderablePublicDocument(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      (input as JsonRecord).type !== "doc") return input;
  // This path is exclusively for the historical TipTap 'doc' discriminator.
  // Validate original and result budgets; never coerce arbitrary foreign schemas.
  checkDocumentResourceLimits(input);
  const legacy = record(input);
  if (!Array.isArray(legacy.content)) throw new Error("Invalid historical document content");
  const result = {
    schema: "vibress-studio" as const,
    version: 1,
    root: { type: "root" as const, children: legacy.content.map(convertLegacyNode) },
  };
  checkDocumentResourceLimits(result);
  return result;
}

export function renderPublicContentPlainText(input: unknown): string {
  return renderStudioDocumentToPlainText(toRenderablePublicDocument(input));
}
