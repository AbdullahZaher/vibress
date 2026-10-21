import { verifySiteAuthToken } from "@vibress/security";

/** Shared production privacy decision, tested independently of Vitest's
 * global-isTest bypass in the Fastify test harness. */
export async function evaluatePublicSiteAccess(
  publicationId: string,
  siteCookie: string | undefined,
  secret: string,
  loadSettings: (publicationId: string) => Promise<{
    security?: Record<string, unknown> | null;
  }>,
): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    const settings = await loadSettings(publicationId);
    // Preserve legacy installations with no explicit security settings:
    // the existing Host policy defaults to public unless isPrivate is true.
    if (settings.security?.isPrivate !== true) return "allowed";
    return verifySiteAuthToken(siteCookie, secret, publicationId)
      ? "allowed" : "denied";
  } catch {
    return "unavailable";
  }
}
