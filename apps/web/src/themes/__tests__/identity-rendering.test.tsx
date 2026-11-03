import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThemeSiteSettings } from "@vibress/theme-core";
import { ThemeLayout as MinimalLayout } from "../minimal/components/Layout";
import { ThemeLayout as MoltenLayout } from "../molten/components/Layout";

vi.mock("../../components/preview/PreviewAnchor", () => ({
  PreviewAnchor: ({ href, children, className }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} className={className}>{children}</a>,
}));
vi.mock("../molten/components/MemberActions", () => ({ MemberActions: () => null }));
const publication: ThemeSiteSettings = {
  title: "مدونة عالمية",
  description: "مقالات عالمية",
  url: "https://example.test",
  locale: "ar",
};

describe("Minimal and Molten publication branding", () => {
  it.each(["minimal", "molten"] as const)("displays an uploaded publication logo in %s", async (theme) => {
    const site = { ...publication, logoUrl: "/media/logo-ar.png", iconUrl: "/media/favicon.png" };
    const tree = theme === "minimal"
      ? await MinimalLayout({ site, settings: {}, children: <main>مقال</main> })
      : <MoltenLayout site={site} settings={{}}><main>مقال</main></MoltenLayout>;
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('src="/media/logo-ar.png"');
    expect(html).toContain('alt="مدونة عالمية"');
    expect(html).not.toContain('src="/media/favicon.png"');
  });

  it.each(["minimal", "molten"] as const)("falls back to Arabic publication title in %s", async (theme) => {
    const tree = theme === "minimal"
      ? await MinimalLayout({ site: publication, settings: {}, children: <main>مقال</main> })
      : <MoltenLayout site={publication} settings={{}}><main>مقال</main></MoltenLayout>;
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("مدونة عالمية");
    expect(html).not.toContain("<img");
  });
});
