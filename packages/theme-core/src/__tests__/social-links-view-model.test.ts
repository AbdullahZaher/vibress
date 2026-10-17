import { describe, it, expect } from "vitest";
import { mapSiteToViewModel } from "../view-models";

describe("social links in external theme view models", () => {
  const base = { title: "Publication", locale: "ar" };
  it("keeps old themes compatible with absent social profiles", () => {
    expect(mapSiteToViewModel(base).socialLinks).toEqual([]);
  });
  it("exposes ordered social links to Liquid views and RTL locale", () => {
    const socialLinks = [
      { id: "1", platform: "x", label: "X", url: "https://x.com/example", iconUrl: "/social-icons/x.svg" },
      { id: "2", platform: "github", label: "GitHub", url: "https://github.com/example", iconUrl: "/social-icons/github.svg" },
    ];
    const result = mapSiteToViewModel({ ...base, socialLinks });
    expect(result.direction).toBe("rtl");
    expect(result.socialLinks).toEqual(socialLinks);
  });
});
