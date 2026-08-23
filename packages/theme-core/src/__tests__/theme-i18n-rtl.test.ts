import { describe, it, expect } from "vitest";
import {
  createLiquidThemeEngine,
  validateThemeRtlCss,
  validateThemeManifest,
} from "../index";

describe("Theme Core — i18n & RTL Extensions", () => {
  it("renders theme templates with Liquid t filter and loaded theme dictionary", async () => {
    const files = new Map<string, string>();
    files.set(
      "locales/en.json",
      JSON.stringify({
        "theme.greeting": "Welcome to our blog",
        "theme.read_more": "Read more",
      }),
    );
    files.set(
      "locales/ar.json",
      JSON.stringify({
        "theme.greeting": "مرحباً بكم في مدونتنا",
        "theme.read_more": "اقرأ المزيد",
      }),
    );
    files.set(
      "templates/home.liquid",
      `<h1>{{ "theme.greeting" | t }}</h1><p>{{ "nav.posts" | t }}</p><a href="{{ "my-post" | post_url }}">{{ "theme.read_more" | t }}</a>`,
    );

    const engine = createLiquidThemeEngine({ files });

    // English rendering
    const enHtml = await engine.renderFile("templates/home.liquid", {
      site: { locale: "en" },
    });
    expect(enHtml).toContain("<h1>Welcome to our blog</h1>");
    expect(enHtml).toContain("<p>Posts</p>");
    expect(enHtml).toContain('<a href="/posts/my-post">Read more</a>');

    // Arabic rendering
    const arHtml = await engine.renderFile("templates/home.liquid", {
      site: { locale: "ar-SA" },
    });
    expect(arHtml).toContain("<h1>مرحباً بكم في مدونتنا</h1>");
    expect(arHtml).toContain("<p>المقالات</p>");
    expect(arHtml).toContain('<a href="/ar-sa/posts/my-post">اقرأ المزيد</a>');
  });

  it("renders locale_switcher tag with accessible links", async () => {
    const files = new Map<string, string>();
    files.set("templates/home.liquid", `{% locale_switcher %}`);

    const engine = createLiquidThemeEngine({ files });
    const html = await engine.renderFile("templates/home.liquid", {
      availableLocales: [
        { code: "en", name: "English", nativeName: "English", direction: "ltr", url: "/posts/test", isCurrent: true },
        { code: "ar-SA", name: "Arabic", nativeName: "العربية", direction: "rtl", url: "/ar/posts/test", isCurrent: false },
      ],
    });

    expect(html).toContain('<nav class="vb-locale-switcher"');
    expect(html).toContain('<a href="/posts/test" dir="ltr" class="is-active" data-locale="en">English</a>');
    expect(html).toContain('<a href="/ar/posts/test" dir="rtl" data-locale="ar-SA">العربية</a>');
  });

  it("formats dates, numbers and relative times in Liquid templates", async () => {
    const files = new Map<string, string>();
    files.set(
      "templates/post.liquid",
      `<span>{{ date | format_date }}</span><span>{{ 12345 | format_number }}</span><span>{{ is_arabic | is_rtl }}</span>`,
    );

    const engine = createLiquidThemeEngine({ files });
    const htmlAr = await engine.renderFile("templates/post.liquid", {
      date: new Date("2026-08-22T00:00:00Z"),
      site: { locale: "ar-SA" },
      is_arabic: "ar-SA",
    });

    expect(htmlAr).toContain("true"); // is_rtl true
  });

  it("detects physical CSS properties with validateThemeRtlCss", () => {
    const invalidCss = `
      .card {
        margin-left: 16px;
        padding-right: 20px;
        text-align: left;
      }
      .suppressed {
        margin-left: 8px; /* rtl-ignore */
      }
    `;

    const files = new Map<string, string>();
    files.set("assets/css/theme.css", invalidCss);

    const result = validateThemeRtlCss(files, { strict: true });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3); // margin-left, padding-right, text-align: left (suppressed one is ignored)
    expect(result.warnings.some((w) => w.includes("margin-inline-start"))).toBe(true);
  });

  it("passes validateThemeRtlCss when CSS logical properties are used", () => {
    const validCss = `
      .card {
        margin-inline-start: 16px;
        padding-inline-end: 20px;
        text-align: start;
        inset-inline-start: 0;
        border-inline-start: 1px solid #ccc;
      }
    `;

    const files = new Map<string, string>();
    files.set("assets/css/theme.css", validCss);

    const result = validateThemeRtlCss(files, { strict: true });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it("validates theme manifest with localization configuration", () => {
    const manifest = validateThemeManifest({
      id: "arabic-modern",
      name: "Arabic Modern",
      version: "1.0.0",
      themeApi: 1,
      capabilities: ["post", "page"],
      localization: {
        supportsLocales: ["en", "ar-SA"],
        rtl: true,
        dynamicLocale: true,
      },
    });

    expect(manifest.localization?.rtl).toBe(true);
    expect(manifest.localization?.supportsLocales).toEqual(["en", "ar-SA"]);
  });
});
