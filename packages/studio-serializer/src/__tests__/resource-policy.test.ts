import { describe, expect, it } from "vitest";
import { createDefaultStudioDocument, getDocumentUtf8ByteLength,
  StudioMigrationError } from "@vibress/studio-core";
import { deserializeStudioDocument, serializeStudioDocument } from "../index";

describe("host outgoing serialization admission", () => {
  it("persists at the exact UTF-8 envelope boundary and reloads the same content", () => {
    const root = createDefaultStudioDocument("مرحبا 😀 English").root;
    const accepted = serializeStudioDocument(root);
    const bytes = getDocumentUtf8ByteLength(JSON.stringify(accepted));
    expect(serializeStudioDocument(root, { maxSizeBytes: bytes })).toEqual(accepted);
    expect(() => serializeStudioDocument(root, { maxSizeBytes: bytes - 1 }))
      .toThrow(StudioMigrationError);
    expect(deserializeStudioDocument(JSON.stringify(accepted), { maxSizeBytes: bytes }))
      .toEqual(accepted);
  });

  it("rejects malformed output rather than silently serializing an empty document", () => {
    expect(() => serializeStudioDocument({ type: "not-root", children: [{ type: "text", text: "Important" }] }))
      .toThrow();
    expect(() => serializeStudioDocument({
      type: "root", children: [{ type: "text", text: "x".repeat(1500) }],
    }, { maxSizeBytes: 512 })).toThrow(StudioMigrationError);
  });
});
