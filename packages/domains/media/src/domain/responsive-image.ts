export type ImageVariantSize = "thumbnail" | "medium" | "large" | "full";
export type ImageVariantFormat = "webp" | "avif" | "jpeg" | "png";

export interface FocalPoint {
  x: number; // 0.0 to 1.0 (0 = left, 1 = right, 0.5 = center)
  y: number; // 0.0 to 1.0 (0 = top, 1 = bottom, 0.5 = center)
}

export interface ImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageTransformOptions {
  focalPoint?: FocalPoint | undefined;
  crop?: ImageCropRect | undefined;
  rotation?: number | undefined; // 0, 90, 180, 270 degrees
}

export interface ImageVariant {
  size: ImageVariantSize;
  format: ImageVariantFormat;
  width: number;
  height: number;
  url: string;
  sizeBytes?: number | undefined;
}

export interface ResponsiveImageMetadata {
  originalWidth: number;
  originalHeight: number;
  aspectRatio: number;
  variants: ImageVariant[];
  focalPoint?: FocalPoint | undefined;
  altText?: string | undefined;
  caption?: string | undefined;
  blurDataUrl?: string | undefined;
}

export const VARIANT_WIDTHS: Record<ImageVariantSize, number> = {
  thumbnail: 300,
  medium: 600,
  large: 1200,
  full: 1920,
};

/**
 * Builds standard HTML srcset attribute value from image variants of a given format
 */
export function generateSrcSet(
  variants: ImageVariant[],
  format: ImageVariantFormat = "webp",
): string {
  const filtered = variants.filter((v) => v.format === format);
  if (filtered.length === 0) {
    // Fall back to all variants if format not present
    return variants.map((v) => `${v.url} ${v.width}w`).join(", ");
  }
  return filtered.map((v) => `${v.url} ${v.width}w`).join(", ");
}

/**
 * Computes proportional dimensions maintaining aspect ratio.
 */
export function calculateTargetDimensions(
  originalWidth: number,
  originalHeight: number,
  targetWidth: number,
): { width: number; height: number } {
  if (originalWidth <= 0 || originalHeight <= 0) {
    return { width: targetWidth, height: targetWidth };
  }
  const aspectRatio = originalHeight / originalWidth;
  const targetHeight = Math.round(targetWidth * aspectRatio);
  return {
    width: targetWidth,
    height: targetHeight,
  };
}

/**
 * Validates and clamps focal point coordinates to valid [0.0, 1.0] range.
 */
export function clampFocalPoint(focalPoint: FocalPoint): FocalPoint {
  return {
    x: Math.max(0, Math.min(1, focalPoint.x)),
    y: Math.max(0, Math.min(1, focalPoint.y)),
  };
}
