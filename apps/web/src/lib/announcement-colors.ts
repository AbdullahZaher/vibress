import { isValidHexColor } from "@vibress/theme-core";

const FALLBACK_BACKGROUND = "#1f2937";

/**
 * Announcement bars share the active (or verified preview) theme palette.
 * Alpha channels are intentionally rendered opaque to guarantee text contrast
 * independent of the underlying page/background and dark mode.
 */
export function announcementColors(settings: Record<string, unknown>): {
  backgroundColor: string;
  color: string;
} {
  const value = isValidHexColor(settings.accentColor)
    ? settings.accentColor.trim().slice(1)
    : FALLBACK_BACKGROUND.slice(1);
  const short = value.length === 3 || value.length === 4;
  const opaque = short
    ? [...value.slice(0, 3)].map((digit) => digit + digit).join("")
    : value.slice(0, 6);
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(opaque.slice(offset, offset + 2), 16) / 255);
  const channels = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  // For opaque colors, either black or white has at least a 4.5:1 contrast ratio.
  return {
    backgroundColor: `#${opaque}`,
    color: luminance <= 0.179 ? "#ffffff" : "#000000",
  };
}
