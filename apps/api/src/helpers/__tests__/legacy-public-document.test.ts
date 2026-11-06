import { describe, expect, it } from "vitest";
import {
  extractTableOfContentsFromDocument,
  renderStudioDocumentToHtml,
  renderStudioDocumentToPlainText,
} from "@vibress/studio-renderer";
import { StudioMigrationError } from "@vibress/studio-core";
import { projectLegacyPublicDocument } from "../legacy-public-document";
import { deriveExcerpt, resolveDocumentMedia } from "../public-content-helpers";

describe("read-only historical public document compatibility", () => {
  const legacy = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Bienvenue sur Vibress" }] },
      { type: "paragraph", content: [{ type: "text", text: "مرحباً بكم في فايبرس" }] },
    ],
  };

  it("renders historical French/Arabic paragraphs without modifying the stored JSON", async () => {
    const original = JSON.stringify(legacy);
    const projected = projectLegacyPublicDocument(legacy);
    expect(projected).toMatchObject({ schema: "vibress-studio", version: 1 });
    expect(renderStudioDocumentToHtml(projected)).toContain("Bienvenue sur Vibress");
    expect(renderStudioDocumentToHtml(projected)).toContain("مرحباً بكم في فايبرس");
    expect(renderStudioDocumentToPlainText(projected)).toContain("Bienvenue sur Vibress");
    expect(extractTableOfContentsFromDocument(projected)).toEqual([]);
    expect(deriveExcerpt(null, legacy)).toContain("مرحباً");
    const resolved = await resolveDocumentMedia(legacy, {} as Parameters<typeof resolveDocumentMedia>[1]);
    expect(renderStudioDocumentToHtml(resolved)).toContain("Bienvenue sur Vibress");
    expect(JSON.stringify(legacy)).toBe(original);
  });

  it("escapes untrusted historical text and never treats text as executable HTML", () => {
    const hostile = {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: '<img src=x onerror="alert(1)">' },
      ] }],
    };
    const html = renderStudioDocumentToHtml(projectLegacyPublicDocument(hostile));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=");
    expect(html).toContain("&lt;img");
  });

  it.each([
    { type: "doc", content: [{ type: "image", attrs: { src: "/asset" } }] },
    { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Bold", marks: [{ type: "bold" }] },
    ] }] },
    { type: "doc", content: [{ type: "paragraph", attrs: { custom: true } }] },
    { type: "doc", content: "not an array" },
  ])("rejects unsupported legacy structures without dropping their contents", (source) => {
    try {
      projectLegacyPublicDocument(source);
      expect.unreachable("Unsupported legacy content must not be projected");
    } catch (err) {
      expect(err).toBeInstanceOf(StudioMigrationError);
      if (err instanceof StudioMigrationError) {
        expect(err.rawDocument).toBe(source);
        expect(err.code).toBe("UNSUPPORTED_DOCUMENT");
      }
    }
  });

  it("does not reinterpret unknown formats or canonical Studio inputs", () => {
    const unsupported = { type: "future-format", content: [] };
    expect(projectLegacyPublicDocument(unsupported)).toBe(unsupported);
    const studio = { schema: "vibress-studio", version: 1, root: { type: "root", children: [] } };
    expect(projectLegacyPublicDocument(studio)).toBe(studio);
  });
});
