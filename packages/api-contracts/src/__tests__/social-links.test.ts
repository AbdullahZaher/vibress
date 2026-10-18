import { describe, it, expect } from "vitest";
import { SocialLinksSchema, toPublicSocialLinks } from "../social-links";

const valid = { id: "one", platform: "instagram", label: "Instagram", url: "https://instagram.com/vibress" };

describe("publication social links contract", () => {
  it("accepts HTTPS profiles and enriches safe icon URLs", () => {
    expect(SocialLinksSchema.safeParse([valid]).success).toBe(true);
    expect(toPublicSocialLinks([valid])[0]?.iconUrl).toBe("/social-icons/instagram.svg");
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "http://example.com", "//example.com", "https://x:y@example.com"])("rejects unsafe URL %s", (url) => {
    expect(SocialLinksSchema.safeParse([{ ...valid, url }]).success).toBe(false);
  });
  it("rejects unknown platforms, duplicate identifiers, and oversized input", () => {
    expect(SocialLinksSchema.safeParse([{ ...valid, platform: "unknown" }]).success).toBe(false);
    expect(SocialLinksSchema.safeParse([valid, valid]).success).toBe(false);
    expect(SocialLinksSchema.safeParse(Array.from({ length: 21 }, (_, i) => ({ ...valid, id: String(i) }))).success).toBe(false);
  });
  it("fails closed for malformed persisted data and strips caller-provided icon URLs", () => {
    expect(toPublicSocialLinks([{ ...valid, url: "javascript:alert(1)" }])).toEqual([]);
    expect(toPublicSocialLinks([{ ...valid, iconUrl: "https://evil.example/x.svg" }])[0]?.iconUrl)
      .toBe("/social-icons/instagram.svg");
  });
});
