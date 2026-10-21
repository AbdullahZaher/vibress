import { describe, expect, it } from "vitest";
import {
  localizedExtensionTitle,
  matchesPublicExtensionPublication,
  publicExtensionMetadata,
  trustedExtensionOrigin,
} from "../public-extension-page-policy";

const view = {
  publicationId: "pub_a", pluginId: "vibress-lms",
  viewId: "courses", routeId: "catalog",
  title: { en: "Courses", ar: "الدورات" },
  data: { total: 3 },
};

function site(publicationId: string, url: string, locale = "en") {
  return {
    publicationId, url, locale, primaryLocale: "en",
    enabledLocales: ["en", "ar"], title: "Vibress",
    security: { isPrivate: false },
  };
}

describe("EXT-302A verified public page policy", () => {
  it("uses the verified publication domain for canonical and Open Graph", () => {
    const result = publicExtensionMetadata(
      view, site("pub_a", "https://publication-a.example"),
      "publication-a.example", true,
    );
    expect(result.alternates?.canonical).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
    expect(result.openGraph && "url" in result.openGraph && result.openGraph.url).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
  });

  it("generates Arabic canonical independently for a second publication", () => {
    const arabicView = { ...view, publicationId: "pub_b" };
    const result = publicExtensionMetadata(
      arabicView, site("pub_b", "https://publication-b.example", "ar"),
      "publication-b.example", true,
    );
    expect(result.title).toBe("الدورات");
    expect(localizedExtensionTitle(view.title, "ar-SA")).toBe("الدورات");
    expect(result.alternates?.canonical).toBe(
      "https://publication-b.example/ar/extensions/vibress-lms/courses",
    );
  });

  it("prevents metadata and SSR from reusing a descriptor across publications", () => {
    const otherSite = site("pub_b", "https://publication-b.example");
    expect(matchesPublicExtensionPublication(view, otherSite)).toBe(false);
    const result = publicExtensionMetadata(
      view, otherSite, "publication-b.example", true,
    );
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.alternates).toBeUndefined();
    expect(matchesPublicExtensionPublication(view, site("pub_a", "https://publication-a.example")))
      .toBe(true);
    expect(matchesPublicExtensionPublication(view, { publicationId: undefined }))
      .toBe(false);
  });

  it("refuses configured foreign canonical origins and malformed host authority", () => {
    const result = publicExtensionMetadata(
      view, site("pub_a", "https://external-attacker.example"),
      "publication-a.example", true,
    );
    expect(result.alternates?.canonical).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
    for (const hostileHost of [null, "x@y.example", "a.example,b.example", "a.example/path"]) {
      expect(trustedExtensionOrigin(
        hostileHost, "https://publication-a.example", true,
      )).toBeNull();
    }
  });

  it("advertises hreflang only for explicitly published, enabled variants", () => {
    const variants = { ...view, locale: "ar", publishedLocales: ["en", "ar", "fr"] };
    const meta = publicExtensionMetadata(
      variants, site("pub_a", "https://publication-a.example", "ar"),
      "publication-a.example", true,
    );
    expect(meta.alternates?.languages).toEqual({
      en: "https://publication-a.example/extensions/vibress-lms/courses",
      ar: "https://publication-a.example/ar/extensions/vibress-lms/courses",
      "x-default": "https://publication-a.example/extensions/vibress-lms/courses",
    });
    const legacy = publicExtensionMetadata(
      view, site("pub_a", "https://publication-a.example"),
      "publication-a.example", true,
    );
    expect(legacy.alternates?.languages).toEqual({});
  });

  it("does not index unpublished locales or previewed extension pages", () => {
    const unpublished = { ...view, locale: "ar", publishedLocales: ["en"] };
    const result = publicExtensionMetadata(
      unpublished, site("pub_a", "https://publication-a.example", "ar"),
      "publication-a.example", true,
    );
    expect(result.robots).toEqual({ index: false, follow: false });
    const preview = publicExtensionMetadata(
      view, site("pub_a", "https://publication-a.example"),
      "publication-a.example", true, true,
    );
    expect(preview.robots).toEqual({ index: false, follow: false });
  });

  it("never creates indexable metadata for an unvalidated host or a private site", () => {
    expect(publicExtensionMetadata(
      view, site("pub_a", "https://publication-a.example"), null, true,
    ).robots).toEqual({ index: false, follow: false });
    expect(publicExtensionMetadata(
      view,
      { ...site("pub_a", "https://publication-a.example"), security: { isPrivate: true } },
      "publication-a.example", true,
    ).robots).toEqual({ index: false, follow: false });
  });
});
