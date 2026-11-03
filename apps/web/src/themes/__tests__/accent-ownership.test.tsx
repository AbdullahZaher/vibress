import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThemeSiteSettings } from "@vibress/theme-core";
import { ThemeLayout as DefaultLayout } from "../default/components/Layout";
import { ThemeLayout as MinimalLayout } from "../minimal/components/Layout";
import { ThemeLayout as MoltenLayout } from "../molten/components/Layout";

vi.mock("../../lib/preview-link-server", () => ({
  getPreviewNavigation: vi.fn(async () => null),
}));
vi.mock("../../components/preview/PreviewAnchor", () => ({
  PreviewAnchor: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../default/components/HeaderNav", () => ({
  HeaderNav: () => <header data-testid="default-header" />,
}));
vi.mock("../molten/components/HeaderNav", () => ({
  HeaderNav: () => <header data-testid="molten-header" />,
}));

const site: ThemeSiteSettings & { accentColor: string } = {
  title: "A publication",
  description: "Published stories",
  url: "https://example.test",
  locale: "ar",
  accentColor: "#ff0000", // Legacy site color must never override Theme Studio.
};

describe("built-in appearance ownership", () => {
  it("renders the Default theme using saved theme colors, not the site legacy color", async () => {
    const markup = renderToStaticMarkup(
      await DefaultLayout({
        site,
        settings: { accentColor: "#123456", colorScheme: "dark" },
        children: <main>مقال</main>,
      }),
    );
    expect(markup).toContain('data-theme="vibress-default"');
    expect(markup).toContain('data-accent="#123456"');
    expect(markup).toContain("--vb-accent-color: #123456");
    expect(markup).toContain("--brand-pink-light: color-mix(in srgb, var(--vb-accent-color) 8%, transparent)");
    expect(markup).not.toContain("--vb-accent-color: #ff0000");
  });

  it("preserves Minimal theme-specific accent rendering", async () => {
    const markup = renderToStaticMarkup(
      await MinimalLayout({
        site,
        settings: { accentColor: "#345678", typography: "Serif" },
        children: <main>مقال</main>,
      }),
    );
    expect(markup).toContain('data-theme="vibress-minimal"');
    expect(markup).toContain('data-accent="#345678"');
    expect(markup).toContain("--vb-accent-color: #345678");
  });

  it("preserves Molten theme-specific accent rendering", () => {
    const markup = renderToStaticMarkup(
      <MoltenLayout site={site} settings={{ accentColor: "#abcdef" }}>
        <main>مقال</main>
      </MoltenLayout>,
    );
    expect(markup).toContain('data-theme="vibress-molten"');
    expect(markup).toContain('data-accent="#abcdef"');
    expect(markup).toContain("--vb-accent-color: #abcdef");
  });

  it("does not inject arbitrary CSS from malformed settings", async () => {
    const markup = renderToStaticMarkup(
      await DefaultLayout({
        site,
        settings: { accentColor: "red; background: url(https://evil.test)" },
        children: <main>Safe</main>,
      }),
    );
    expect(markup).toContain("--vb-accent-color: #f05230");
    expect(markup).not.toContain("evil.test");
  });
});
