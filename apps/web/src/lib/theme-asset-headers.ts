/** HTTP response headers for public theme assets.
 * SVG remains addressable for existing themes but cannot execute as an
 * active navigated XML document. The caller owns the cache policy.
 */
export function themeAssetResponseHeaders(
  mimeType: string,
  cacheControl: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };
  if (mimeType === "image/svg+xml") {
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
    headers["Content-Disposition"] = "attachment";
  }
  return headers;
}
