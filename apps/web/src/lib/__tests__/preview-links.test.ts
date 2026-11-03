import { describe, expect, it } from "vitest";
import { rewritePreviewHtml, toPreviewHref } from "../preview-links";

const navigation = { prefix: "/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", currentPath: "/" };

describe("theme preview link navigation", () => {
  it("preserves the preview token for internal routes and query strings", () => {
    expect(toPreviewHref("/posts/hello-world", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/posts/hello-world");
    expect(toPreviewHref("/pages/about?view=full#section", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pages/about?view=full#section");
    expect(toPreviewHref("/ar/tags/design", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ar/tags/design");
    expect(toPreviewHref("/?page=2", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/?page=2");
    expect(toPreviewHref("/", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/");
  });
  it("resolves relative paths against the canonical content route", () => {
    expect(toPreviewHref("posts/a", navigation)).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/posts/a");
    expect(toPreviewHref("../other", { ...navigation, currentPath: "/posts/first" })).toBe("/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/other");
  });
  it("does not rewrite hash navigation, system links, or external links", () => {
    for (const href of ["#comments", "?page=3", "/portal/#/sign-in", "/admin/", "/api/content", "/theme-assets/cover.css", "https://example.com/posts/a", "//example.com/a", "mailto:editor@example.com", "javascript:alert(1)", "/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/posts/a"]) {
      expect(toPreviewHref(href, navigation)).toBe(href);
    }
  });
  it("does not rewrite ordinary public pages or accept an invalid prefix", () => {
    expect(toPreviewHref("/posts/a", null)).toBe("/posts/a");
    expect(toPreviewHref("/posts/a", { prefix: "/preview/not-valid", currentPath: "/" })).toBe("/posts/a");
  });
  it("rewrites only anchor hrefs in rendered HTML", () => {
    const html = '<a class="post" href="/posts/a?x=1">Read</a><a href=\'https://outside.com/\'>External</a><img src="/posts/image.png"><a href="#notes">Notes</a>';
    const result = rewritePreviewHtml(html, navigation);
    expect(result).toContain('href="/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/posts/a?x=1"');
    expect(result).toContain("href='https://outside.com/'");
    expect(result).toContain('src="/posts/image.png"');
    expect(result).toContain('href="#notes"');
    expect(rewritePreviewHtml(html, null)).toBe(html);
  });
});
