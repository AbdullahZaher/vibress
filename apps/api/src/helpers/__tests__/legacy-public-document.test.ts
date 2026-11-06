import { describe, expect, it } from "vitest";
import { extractTableOfContentsFromDocument, renderStudioDocumentToHtml } from "@vibress/studio-renderer";
import { renderPublicContentPlainText, toRenderablePublicDocument } from "../legacy-public-document";

describe("read-only historical public content compatibility", () => {
  it("renders legacy multilingual paragraphs, without changing their stored structure", () => {
    const original = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "مرحبا English" }] },
      { type: "paragraph", content: [{ type: "text", text: "Contenu en français" }] },
    ] };
    const bytes = JSON.stringify(original);
    const renderable = toRenderablePublicDocument(original);
    expect(JSON.stringify(original)).toBe(bytes);
    const html = renderStudioDocumentToHtml(renderable);
    expect(html).toContain("<p>مرحبا English</p>");
    expect(html).toContain("<p>Contenu en français</p>");
    expect(renderPublicContentPlainText(original)).toContain("مرحبا English");
    expect(extractTableOfContentsFromDocument(renderable)).toEqual([]);
  });

  it("retains headings, lists, emphasis and safe links in a public-only projection", () => {
    const legacy = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "عنوان English" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [
          { type: "text", text: "Strong", marks: [{ type: "bold" }] },
          { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        ] },
      ] }] },
    ] };
    const doc = toRenderablePublicDocument(legacy);
    const html = renderStudioDocumentToHtml(doc);
    expect(html).toContain("عنوان English");
    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("https://example.com");
    expect(extractTableOfContentsFromDocument(doc)).toEqual([
      { text: "عنوان English", level: 2, id: "عنوان-english" },
    ]);
  });

  it("does not turn dangerous link schemes into executable HTML", () => {
    const legacy = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "<b>not markup</b>", marks: [
        { type: "link", attrs: { href: "javascript:alert(1)" } },
      ] },
    ] }] };
    const html = renderStudioDocumentToHtml(toRenderablePublicDocument(legacy));
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;b&gt;not markup&lt;/b&gt;");
  });

  it("does not coerce unsupported legacy structures or foreign non-doc formats", () => {
    const unsupported = { type: "doc", content: [{ type: "iframe", attrs: { src: "https://x.test" } }] };
    expect(() => toRenderablePublicDocument(unsupported)).toThrow("Unsupported historical publication node");
    const foreign = { schema: "something-else", type: "custom", content: [] };
    expect(toRenderablePublicDocument(foreign)).toBe(foreign);
  });
});
