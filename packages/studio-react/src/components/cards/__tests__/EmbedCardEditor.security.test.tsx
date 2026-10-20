import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbedCardEditor } from "../EmbedCardEditor";

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [{ update: () => undefined }],
}));
vi.mock("@lexical/react/useLexicalNodeSelection", () => ({
  useLexicalNodeSelection: () => [false, () => undefined, () => undefined],
}));
vi.mock("../NestedCaptionEditor", () => ({
  NestedCaptionEditor: () => null,
}));
vi.mock("../../ui/UrlPlaceholder", () => ({
  UrlPlaceholder: () => null,
}));
vi.mock("../../ui/StudioMediaFloatingToolbar", () => ({
  StudioMediaFloatingToolbar: () => null,
}));
vi.mock("../../ui/media-popovers/EmbedMetadataPopover", () => ({
  EmbedMetadataPopover: () => null,
}));

function preview(url: string, html?: string) {
  return renderToStaticMarkup(
    <EmbedCardEditor
      nodeKey="embed-preview-test"
      cardData={{ url, embedType: "video", caption: "", ...(html ? { html } : {}) }}
    />,
  );
}

describe("EmbedCardEditor security boundary", () => {
  it("sanitizes persisted embed HTML before assigning innerHTML", () => {
    const html = preview(
      "https://www.youtube.com/watch?v=abc123",
      '<img src="x.png" onerror="alert(1)"><svg onload="alert(2)"></svg><script>alert(3)</script>',
    );
    expect(html).toContain("<img");
    expect(html).not.toMatch(/onerror|onload|<script|<svg/i);
  });

  it("preserves safe approved provider embeds", () => {
    const html = preview("https://www.youtube.com/watch?v=abc123");
    expect(html).toContain("https://www.youtube-nocookie.com/embed/abc123");
    expect(html).toContain("<iframe");
  });

  it("renders an external link instead of arbitrary third-party iframes", () => {
    const html = preview("https://untrusted.example/embed");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("https://untrusted.example/embed");
  });

  it("does not turn javascript URLs into navigation or frames", () => {
    const html = preview("javascript:alert(1)");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("Unsupported embed URL");
  });
});
