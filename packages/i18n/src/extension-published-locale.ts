/**
 * A plugin may advertise content for a base language (for example "ar")
 * while the publication enables a specific regional locale ("ar-SA").
 * Callers MUST independently authorize the requested locale against the
 * publication's enabled locales before using this content declaration.
 */
export function supportsPublishedExtensionLocale(
  publishedLocales: readonly string[] | undefined,
  requestedLocale: string,
): boolean {
  if (!publishedLocales) return true;
  if (publishedLocales.includes(requestedLocale)) return true;
  const dash = requestedLocale.indexOf("-");
  return dash > 0 && publishedLocales.includes(requestedLocale.slice(0, dash));
}
