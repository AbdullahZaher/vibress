// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { renderThemeTemplate } from "../theme-renderer";

const tempRoots: string[] = [];
const site = {
  publicationId: "pub_extension_themes",
  title: "Vibress", description: "Global CMS", url: "https://example.org",
  locale: "ar", primaryLocale: "en", enabledLocales: ["en", "ar"],
};
const extension = {
  pluginId: "hello-public", viewId: "overview",
  title: "إضافة مرحباً", locale: "ar" as const, direction: "rtl" as const,
  data: { headline: "<script>alert(1)</script>", count: 1 },
};

afterEach(() => {
  delete process.env.THEME_STORAGE_ROOT;
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("EXT-303 theme-independent extension view slot", () => {
  it("gives legacy built-in themes semantic, escaped Arabic/RTL fallback", async () => {
    const element = await renderThemeTemplate("extension", { extension }, {
      themeId: "vibress-default", isBuiltIn: true,
      settings: {}, site,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("uses the accessible fallback if an external Liquid theme lacks extension.liquid", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-extension-slot-"));
    tempRoots.push(root);
    process.env.THEME_STORAGE_ROOT = root;
    const folder = path.join(root, "publications", site.publicationId,
      "external-extension-test", "1.0.0", "templates");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "home.liquid"), "<h1>Wrong homepage</h1>");
    const element = await renderThemeTemplate("extension", { extension }, {
      themeId: "external-extension-test", themeVersion: "1.0.0",
      isBuiltIn: false, settings: {}, site,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("إضافة مرحباً");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Wrong homepage");
  });

  it("passes only escaped scalar view-model fields to external Liquid themes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibress-extension-slot-"));
    tempRoots.push(root);
    process.env.THEME_STORAGE_ROOT = root;
    const folder = path.join(root, "publications", site.publicationId,
      "external-locale-slot", "1.0.0", "templates");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "extension.liquid"),
      '<section lang="{{ extension.locale }}" dir="{{ extension.direction }}">' +
      '<h1>{{ extension.title }}</h1><p>{{ extension.data.headline }}</p></section>');
    const element = await renderThemeTemplate("extension", { extension }, {
      themeId: "external-locale-slot", themeVersion: "1.0.0",
      isBuiltIn: false, settings: {}, site,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
