import { describe, expect, it } from "vitest";
import {
  checkDocumentResourceLimits, createDefaultStudioDocument,
  getDocumentUtf8ByteLength, migrateDocument, StudioMigrationError,
} from "../index";

describe("host v1 document admission and recoverability", () => {
  it("never replaces a non-null unrecognized persisted document with empty content", () => {
    const original = { schema: "future-format", root: { type: "root", children: [] } };
    expect(() => migrateDocument(original)).toThrow(StudioMigrationError);
    try { migrateDocument(original); }
    catch (error) {
      expect(error).toBeInstanceOf(StudioMigrationError);
      expect((error as StudioMigrationError).rawDocument).toBe(original);
      expect((error as StudioMigrationError).code).toBe("UNSUPPORTED_DOCUMENT");
    }
    expect(() => migrateDocument('{"schema":')).toThrow(StudioMigrationError);
    expect(() => migrateDocument({ root: "invalid" })).toThrow(StudioMigrationError);
    expect(() => migrateDocument({ schema: "vibress-studio", version: 2,
      root: { type: "root", children: [] } })).toThrow(StudioMigrationError);
  });

  it("supports intentional blank input, plain legacy text and legacy card normalization", () => {
    expect(migrateDocument(null).root.type).toBe("root");
    expect(JSON.stringify(migrateDocument("legacy plain text"))).toContain("legacy plain text");
    const original = createDefaultStudioDocument("عربي 😀");
    original.root.children.push({
      type: "react-studio-card", version: 1, cardType: "callout",
      cardData: { text: "unknown forward field", custom: "retain" },
    });
    const restored = migrateDocument(JSON.stringify(original));
    expect(JSON.stringify(restored)).toContain('"type":"studio-card"');
    expect(JSON.stringify(restored)).toContain('"custom":"retain"');
  });

  it("counts UTF-8 JSON bytes exactly at a configurable boundary", () => {
    const doc = createDefaultStudioDocument("مرحبا 😀 English");
    const bytes = getDocumentUtf8ByteLength(JSON.stringify(doc));
    expect(() => checkDocumentResourceLimits(doc, { maxSizeBytes: bytes })).not.toThrow();
    expect(() => checkDocumentResourceLimits(doc, { maxSizeBytes: bytes - 1 }))
      .toThrow(StudioMigrationError);
    expect(() => migrateDocument(JSON.stringify(doc), { maxSizeBytes: bytes })).not.toThrow();
  });

  it("rejects too many AST nodes, excessive depth, class instances and cyclic data", () => {
    const doc = createDefaultStudioDocument("short");
    expect(() => checkDocumentResourceLimits(doc, { maxNodeCount: 2 }))
      .toThrow(StudioMigrationError);
    expect(() => checkDocumentResourceLimits(doc, { maxDepth: 3 }))
      .toThrow(StudioMigrationError);
    expect(() => checkDocumentResourceLimits({ root: new Date() }))
      .toThrow(StudioMigrationError);
    const cyclic: { type: string; children: unknown[] } = { type: "root", children: [] };
    cyclic.children.push(cyclic);
    expect(() => checkDocumentResourceLimits(cyclic)).toThrow(StudioMigrationError);
  });

  it("does not execute hostile getters or toJSON while checking incoming content", () => {
    let reads = 0;
    const raw: Record<string, unknown> = { type: "root", children: [] };
    Object.defineProperty(raw, "type", { enumerable: true, get() { reads++; return "root"; } });
    expect(() => checkDocumentResourceLimits(raw)).toThrow(StudioMigrationError);
    expect(reads).toBe(0);
    const alternate = { type: "root", children: [],
      toJSON() { reads++; return {}; } };
    expect(() => checkDocumentResourceLimits(alternate)).toThrow(StudioMigrationError);
    expect(reads).toBe(0);
  });
});
