import { describe, expect, it } from "vitest";
import { createDefaultStudioDocument } from "@vibress/studio-core";
import { serializeStudioDocument } from "../index";

describe("source envelope serialization", () => {
  it("uses the current root and preserves an admitted source envelope", () => {
    const source = {
      ...createDefaultStudioDocument("Before"),
      publicationMetadata: { status: "review" },
      editor: { lexicalVersion: "0.13.1", extension: { retained: true } },
    };
    const current = createDefaultStudioDocument("After");
    const serialized = serializeStudioDocument(current.root, undefined, source);
    expect(serialized).toEqual({ ...source, root: current.root });
    expect(source.root).not.toEqual(current.root);
  });
  it("never serializes a future source as v1", () => {
    const source = { ...createDefaultStudioDocument("Future"), version: 2 };
    expect(() =>
      serializeStudioDocument(source.root, undefined, source),
    ).toThrow();
  });
});
