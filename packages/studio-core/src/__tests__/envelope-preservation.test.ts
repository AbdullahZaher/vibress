import { describe, expect, it } from "vitest";
import {
  createDefaultStudioDocument,
  migrateDocument,
  validateStudioDocument,
} from "../index";

describe("persisted envelope compatibility", () => {
  it("retains unknown envelope and editor metadata through validation and reload", () => {
    const value = {
      ...createDefaultStudioDocument("مسودة English"),
      publicationMetadata: { status: "review" },
      editor: { lexicalVersion: "0.13.1", extension: { author: "retained" } },
    };
    expect(validateStudioDocument(value)).toEqual(value);
    expect(migrateDocument(JSON.stringify(value))).toEqual(value);
    expect(value.publicationMetadata.status).toBe("review");
  });
  it("preserves future persisted envelopes for recovery without downgrading", () => {
    const future = {
      ...createDefaultStudioDocument("Future content"),
      version: 2,
      future: { retained: true },
    };
    expect(validateStudioDocument(future)).toEqual(future);
    for (const original of [future, JSON.stringify(future)]) {
      try {
        migrateDocument(original);
        expect.unreachable("Future editor input must recover");
      } catch (error) {
        expect(error).toMatchObject({
          code: "UNSUPPORTED_DOCUMENT",
          rawDocument: original,
        });
      }
    }
  });
});


it("does not normalize opaque envelope/editor values as Lexical nodes", () => {
  const value = {
    ...createDefaultStudioDocument("Keep text"),
    publicationMetadata: { type: "react-studio-card", custom: "opaque" },
    editor: { extension: { type: "react-studio-card", custom: "opaque editor" } },
  };
  expect(migrateDocument(value)).toEqual(value);
  expect(migrateDocument(JSON.stringify(value))).toEqual(value);
});
