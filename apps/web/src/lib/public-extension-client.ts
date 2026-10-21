import { cache } from "react";
import { headers } from "next/headers";
import {
  ExtensionPublicViewDtoSchema, ExtensionPublicProjectionSchema,
} from "@vibress/api-contracts";

/** Public, publication-resolved scalar data only. Never pass Member/Staff
 * cookies or let SSR callers select a tenant from the query string. */
export interface PublicExtensionPage {
  readonly pluginId: string;
  readonly viewId: string;
  readonly routeId: string;
  readonly title: { readonly en: string; readonly ar: string };
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

const SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
const PLUGIN_SEGMENT = /^[a-z0-9][a-z0-9-]{0,99}$/;

async function fetchPublicApi(path: string): Promise<unknown | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const siteCookie = h.get("cookie")?.split(";").map((s) => s.trim())
    .find((cookie) => cookie.startsWith("vb_site_auth="));
  const base = (process.env.API_URL || "http://127.0.0.1:7780").replace(/\/+$/, "");
  const response = await fetch(`${base}/api/content/v1${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(host ? { "x-forwarded-host": host } : {}),
      ...(siteCookie ? { cookie: siteCookie } : {}),
    },
  });
  if (response.status === 404 || response.status === 403) return null;
  // Fail closed and do not fall back to another publication on API outages.
  if (!response.ok) throw new Error("Public extension view unavailable");
  return response.json();
}

/** React request memoization only; no cross-request/tenant cache. */
export const getPublicExtensionPage = cache(async (
  pluginId: string, viewId: string,
): Promise<PublicExtensionPage | null> => {
  if (!PLUGIN_SEGMENT.test(pluginId) || !SEGMENT.test(viewId)) return null;
  const prefix = `/extensions/${encodeURIComponent(pluginId)}`;
  const descriptor = ExtensionPublicViewDtoSchema.safeParse(
    await fetchPublicApi(`${prefix}/views/${encodeURIComponent(viewId)}`),
  );
  if (!descriptor.success || descriptor.data.pluginId !== pluginId ||
      descriptor.data.viewId !== viewId) return null;
  const projection = ExtensionPublicProjectionSchema.safeParse(
    await fetchPublicApi(`${prefix}/v1/${encodeURIComponent(descriptor.data.routeId)}`),
  );
  if (!projection.success) return null;
  return {
    pluginId, viewId, routeId: descriptor.data.routeId,
    title: descriptor.data.title, data: projection.data,
  };
});
