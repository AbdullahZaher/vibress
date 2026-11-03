import { describe, expect, it } from "vitest";
import { mapSiteToViewModel } from "@vibress/theme-core";

describe("external Liquid site identity contract", () => {
  it("preserves existing icon, logo, cover and legacy accent fields", () => {
    const site = mapSiteToViewModel({
      title: "مثال",
      locale: "ar",
      description: "نص عربي",
      url: "https://example.test",
      logoUrl: "/media/logo.png",
      iconUrl: "/media/favicon.png",
      coverUrl: "/media/cover.jpg",
      accentColor: "#aabbcc",
    });
    expect(site.title).toBe("مثال");
    expect(site.direction).toBe("rtl");
    expect(site.logo).toBe("/media/logo.png");
    expect(site.icon).toBe("/media/favicon.png");
    expect(site.coverImage).toBe("/media/cover.jpg");
    expect(site.accentColor).toBe("#aabbcc");
  });
});
