export interface PublicationThemeScope {
  publicationId: string;
  activeThemeId: string;
  activeThemeVersion: string;
}

const PUBLIC_EXTERNAL_THEME_ASSET_EXTENSIONS = new Set([
  ".css",
  ".woff2",
  ".woff",
  ".ttf",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".svg",
  ".avif",
]);

export function isPublicExternalThemeAssetPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const fileName = normalized.split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return false;
  return PUBLIC_EXTERNAL_THEME_ASSET_EXTENSIONS.has(
    fileName.slice(dotIndex).toLowerCase(),
  );
}

export function shouldAllowLegacyThemeFallback(
  scope: PublicationThemeScope | null,
  themeId: string,
  version: string,
  hasScopedPackage = false,
): boolean {
  if (!scope) return false;
  if (scope.publicationId === "pub_default") return true;
  // Missing files from an installed publication-owned package must never
  // resolve to the shared legacy package with the same theme ID/version.
  if (hasScopedPackage) return false;
  return (
    scope.activeThemeId === themeId &&
    scope.activeThemeVersion === version
  );
}
