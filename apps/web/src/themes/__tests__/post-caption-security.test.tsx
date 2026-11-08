import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThemeSiteSettings } from "@vibress/theme-core";

vi.mock("../default/components/Layout", () => ({
  ThemeLayout: ({ children }: { children: React.ReactNode }) => <div id="layout-mock">{children}</div>,
}));
vi.mock("../minimal/components/Layout", () => ({
  ThemeLayout: ({ children }: { children: React.ReactNode }) => <div id="layout-mock">{children}</div>,
}));
vi.mock("../molten/components/Layout", () => ({
  ThemeLayout: ({ children }: { children: React.ReactNode }) => <div id="layout-mock">{children}</div>,
}));

vi.mock("../../components/preview/PreviewAnchor", () => ({
  PreviewAnchor: ({ href, children, className }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("../molten/components/MemberActions", () => ({ MemberActions: () => null }));
vi.mock("../../components/ReadingProgressBar", () => ({ ReadingProgressBar: () => null }));
vi.mock("../../components/CodeCopyHandler", () => ({ CodeCopyHandler: () => null }));
vi.mock("../../components/ImageLightbox", () => ({ ImageLightbox: () => null }));
vi.mock("../../components/comments/CommentSection", () => ({ CommentSection: () => null }));

import { Post as DefaultPost } from "../default/components/Post";
import { Post as MinimalPost } from "../minimal/components/Post";
import { Post as MoltenPost } from "../molten/components/Post";

const site: ThemeSiteSettings = {
  title: "Vibress Test",
  description: "Test Site",
  url: "https://example.test",
  locale: "en",
};

describe("Post feature-image caption security across themes", () => {
  const basePost = {
    id: "post_1",
    slug: "post-1",
    title: "Test Post",
    excerpt: "Excerpt",
    html: "<p>Content</p>",
    commentCount: 0,
    featureImage: {
      url: "/content/media/test.jpg",
      alt: "Feature image",
      caption: '<script>alert("xss")</script><img src=x onerror=alert(1)><em>Safe caption</em>',
    },
  };

  it.each([
    ["default", DefaultPost],
    ["minimal", MinimalPost],
    ["molten", MoltenPost],
  ] as const)("sanitizes malicious rich HTML caption in %s theme", async (_, PostComponent) => {
    const element = await PostComponent({ site, settings: {}, post: basePost as any });
    const markup = renderToStaticMarkup(element);

    // figcaption must exist and contain safe formatted text
    const figcaption = markup.match(/<figcaption>[\s\S]*?<\/figcaption>/)?.[0] || "";
    expect(figcaption).toContain("<figcaption>");
    expect(figcaption).toContain("<em>Safe caption</em>");

    // Must NOT contain scripts or inline event handlers
    expect(figcaption).not.toMatch(/<script|alert\(|onerror/i);
  });

  it.each([
    ["default", DefaultPost],
    ["minimal", MinimalPost],
    ["molten", MoltenPost],
  ] as const)("renders plain text captions safely without HTML parsing in %s theme", async (_, PostComponent) => {
    const plainPost = {
      ...basePost,
      featureImage: {
        url: "/content/media/test.jpg",
        alt: "Feature image",
        caption: "A photo of mountains by John Doe",
      },
    };

    const element = await PostComponent({ site, settings: {}, post: plainPost as any });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("<figcaption>A photo of mountains by John Doe</figcaption>");
  });
});
