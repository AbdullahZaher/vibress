import { describe, expect, it } from "vitest";
import { themeAssetResponseHeaders } from "../../../../lib/theme-asset-headers";

describe("theme asset security headers", () => {
  it("forces SVG downloads with restrictive sandbox CSP and nosniff", () => {
    const headers = themeAssetResponseHeaders(
      "image/svg+xml",
      "public, max-age=3600",
    );
    expect(headers["Content-Type"]).toBe("image/svg+xml");
    expect(headers["Content-Disposition"]).toBe("attachment");
    expect(headers["Content-Security-Policy"]).toBe("sandbox; default-src 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("keeps normal raster images usable without a download disposition", () => {
    const headers = themeAssetResponseHeaders(
      "image/png",
      "public, max-age=3600",
    );
    expect(headers["Content-Disposition"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("does not cache private or untrusted responses accidentally", () => {
    const cacheControl = "private, no-store";
    const headers = themeAssetResponseHeaders("image/svg+xml", cacheControl);
    expect(headers["Cache-Control"]).toBe(cacheControl);
  });
});
