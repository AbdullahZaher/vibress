/** Operator environment lookups for the server-side theme renderer.
 * Keep Vite's environment replacement separate from TSX source parsing.
 * Values remain read at the same point as the previous inline expressions.
 */
export const THEME_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 60 * 1000 : 0;

export function getThemeStorageRoot() {
  return process.env.THEME_STORAGE_ROOT || process.env.CONTENT_DIR;
}

export function getThemeAssetRevision() {
  return process.env.GIT_SHA || Date.now().toString();
}
