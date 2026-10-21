import { verifySiteAuthToken } from "@vibress/security";

/** Shared production privacy decision, tested independently of Vitest's
 * global-isTest bypass in the Fastify test harness. */
export async function evaluatePublicSiteAccess(
  publicationId: string,
  siteCookie: string | undefined,
  secret: string,
  loadSettings: (publicationId: string) => Promise<{
    security?: { isPrivate?: boolean } | null;
  }>,
): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    const settings = await loadSettings(publicationId);
    if (!settings.security || typeof settings.security.isPrivate !== "boolean") {
      return "unavailable";
    }
    if (!settings.security.isPrivate) return "allowed";
    return verifySiteAuthToken(siteCookie, secret, publicationId)
      ? "allowed" : "denied";
  } catch {
    return "unavailable";
  }
}
