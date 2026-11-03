import { describe, expect, it } from "vitest";
import { announcementColors } from "../announcement-colors";

function contrastRatio(background: string, foreground: string): number {
  const luminance = (color: string) => {
    const rgb = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255);
    const c = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const a = luminance(background);
  const b = luminance(foreground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("announcement color ownership and WCAG contrast", () => {
  it("uses the active theme accent rather than the legacy site palette", () => {
    expect(announcementColors({ accentColor: "#f05230" }).backgroundColor).toBe("#f05230");
    expect(announcementColors({ accentColor: "#000000" }).color).toBe("#ffffff");
    expect(announcementColors({ accentColor: "#ffffff" }).color).toBe("#000000");
  });

  it("accepts schema-valid compact and alpha colors as opaque backgrounds", () => {
    expect(announcementColors({ accentColor: "#abc8" }).backgroundColor).toBe("#aabbcc");
    expect(announcementColors({ accentColor: "#33445580" }).backgroundColor).toBe("#334455");
  });

  it("falls back safely for external themes without a color schema", () => {
    expect(announcementColors({}).backgroundColor).toBe("#1f2937");
    expect(announcementColors({ accentColor: "red; background: url(x)" }).backgroundColor).toBe("#1f2937");
  });

  it.each(["#6366f1", "#f05230", "#000000", "#ffffff", "#777777", "#aabbcc", "#efefef", "#0f0"])(
    "meets WCAG AA for %s", (accentColor) => {
      const { backgroundColor, color } = announcementColors({ accentColor });
      expect(contrastRatio(backgroundColor, color)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
