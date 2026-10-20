import { describe, expect, it } from "vitest";
import { getContentDisposition } from "../routes/media-stream";

describe("Media streaming response disposition", () => {
  it("downloads SVG assets instead of opening active XML in the application origin", () => {
    expect(getContentDisposition("image/svg+xml", "/media/logo.svg")).toMatch(/^attachment;/);
  });

  it("preserves inline rendering for ordinary raster images", () => {
    expect(getContentDisposition("image/png", "/media/logo.png")).toMatch(/^inline;/);
  });

  it("retains safe RFC 5987 encoded filenames", () => {
    expect(getContentDisposition("image/svg+xml", "/media/شعار.svg")).toContain("filename*=UTF-8''");
  });
});
