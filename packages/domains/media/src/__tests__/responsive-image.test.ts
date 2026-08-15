import { describe, it, expect } from "vitest";
import {
  generateSrcSet,
  calculateTargetDimensions,
  clampFocalPoint,
  ImageVariant,
} from "../index";

describe("Media Platform 2.0 & Responsive Image Pipeline", () => {
  const sampleVariants: ImageVariant[] = [
    {
      size: "thumbnail",
      format: "webp",
      width: 300,
      height: 200,
      url: "https://cdn.example.com/images/hero-300w.webp",
    },
    {
      size: "medium",
      format: "webp",
      width: 600,
      height: 400,
      url: "https://cdn.example.com/images/hero-600w.webp",
    },
    {
      size: "large",
      format: "webp",
      width: 1200,
      height: 800,
      url: "https://cdn.example.com/images/hero-1200w.webp",
    },
    {
      size: "thumbnail",
      format: "avif",
      width: 300,
      height: 200,
      url: "https://cdn.example.com/images/hero-300w.avif",
    },
  ];

  it("generates correct HTML srcset attribute for specified image format", () => {
    const webpSrcSet = generateSrcSet(sampleVariants, "webp");
    expect(webpSrcSet).toBe(
      "https://cdn.example.com/images/hero-300w.webp 300w, https://cdn.example.com/images/hero-600w.webp 600w, https://cdn.example.com/images/hero-1200w.webp 1200w",
    );

    const avifSrcSet = generateSrcSet(sampleVariants, "avif");
    expect(avifSrcSet).toBe("https://cdn.example.com/images/hero-300w.avif 300w");
  });

  it("calculates proportional target dimensions maintaining aspect ratio", () => {
    const dims = calculateTargetDimensions(1920, 1080, 600);
    expect(dims.width).toBe(600);
    expect(dims.height).toBe(338); // Math.round(600 * (1080/1920)) = 338
  });

  it("clamps focal point coordinates within valid 0.0 to 1.0 boundary", () => {
    expect(clampFocalPoint({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    expect(clampFocalPoint({ x: -0.2, y: 1.5 })).toEqual({ x: 0, y: 1 });
  });
});

