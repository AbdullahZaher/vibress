import { headers } from "next/headers";
import type { PreviewNavigation } from "./preview-links";

/** Headers are stripped from incoming requests and set only after API
 * validation in the preview branch of the web middleware. */
export async function getPreviewNavigation(): Promise<PreviewNavigation | null> {
  try {
    const h = await headers();
    const token = h.get("x-vibress-preview-token");
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
    const path = h.get("x-vibress-preview-path") || "/";
    return {
      prefix: "/preview/" + token,
      currentPath: path.startsWith("/") && !path.startsWith("//") ? path : "/",
    };
  } catch {
    // Rendering in tests, static/fallback contexts, or outside a live
    // preview request must never change public links or crash the page.
    return null;
  }
}
