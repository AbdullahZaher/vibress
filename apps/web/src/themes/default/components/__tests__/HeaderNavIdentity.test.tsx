import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeaderNav } from "../HeaderNav";

vi.mock("../../../../lib/useMember", () => ({ useMember: () => null }));
vi.mock("../../../../components/reader/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../SubscribeModal", () => ({ SubscribeModal: () => null }));

describe("Default header publication-owned assets", () => {
  it("prefers the publication logo over its favicon and keeps a readable title", () => {
    const html = renderToStaticMarkup(
      <HeaderNav siteTitle="الموقع العربي" previewNavigation={null}
        siteLogo="/media/logo.png" siteIcon="/media/favicon.png" />,
    );
    expect(html).toContain('src="/media/logo.png"');
    expect(html).not.toContain('src="/media/favicon.png"');
    expect(html).toContain("الموقع العربي");
    expect(html).toContain('alt=""');
  });

  it("preserves historical favicon fallback if no logo exists", () => {
    const html = renderToStaticMarkup(
      <HeaderNav siteTitle="Vibress" previewNavigation={null} siteIcon="/media/icon.png" />,
    );
    expect(html).toContain('src="/media/icon.png"');
    expect(html).toContain('class="vb-head-logo-icon"');
    expect(html).toContain("Vibress");
  });

  it("renders the publication title alone when no image is configured", () => {
    const html = renderToStaticMarkup(
      <HeaderNav siteTitle="Vibress" previewNavigation={null} />,
    );
    expect(html).toContain("Vibress");
    expect(html).not.toContain("<img");
  });
});
