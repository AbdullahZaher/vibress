import { isIP } from "node:net";
import { cache } from "react";
import { headers } from "next/headers";
import { ExtensionPublicPageResponseSchema, ExtensionPublicViewIdentitySchema } from "@vibress/api-contracts";

/** A Host-authorized public result, including the authoritative publication
 * identity used to verify publication-scoped site metadata before rendering. */
export interface PublicExtensionPage {
  readonly publicationId: string;
  readonly pluginId: string;
  readonly viewId: string;
  readonly routeId: string;
  readonly locale?: string | undefined;
  readonly publishedLocales?: readonly string[] | undefined;
  readonly title: { readonly en: string; readonly ar: string };
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

const SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
const PLUGIN_SEGMENT = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * The production gateway overwrites Host and X-Real-IP. Do not use the
 * incoming X-Forwarded-Host as an authority for tenant selection: it can be
 * supplied directly by a browser on incorrectly configured proxies.
 */
export function isValidPublicHost(host: string): boolean {
  if (!host || host.length > 253 || /\s/.test(host) || /[,#?]/.test(host) || host.includes("/") || host.includes("\\")) return false;
  try {
    const url = new URL(`http://${host}`);
    return url.username === "" && url.password === "" &&
      url.host.toLowerCase() === host.toLowerCase() &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function loadPublicExtensionPage(
  pluginId: string, viewId: string,
): Promise<PublicExtensionPage | null> {
  if (!PLUGIN_SEGMENT.test(pluginId) || !SEGMENT.test(viewId)) return null;
  const h = await headers();
  const host = h.get("host");
  if (!host || !isValidPublicHost(host)) {
    // Do not fall back to a default publication on missing/spoofed hosts.
    throw new Error("Public extension hostname unavailable");
  }
  const siteCookie = h.get("cookie")?.split(";").map((s) => s.trim())
    .find((cookie) => cookie.startsWith("vb_site_auth="));
  // Use only the gateway-overwritten real IP, never arbitrary browser XFF.
  // Preserves per-visitor API rate limits for internally proxied Next.js SSR.
  const visitorIp = h.get("x-real-ip");
  const requestedLocale = h.get("x-vibress-locale");
  const localeQuery = requestedLocale &&
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(requestedLocale)
    ? `?locale=${encodeURIComponent(requestedLocale)}` : "";
  const base = (process.env.API_URL || "http://127.0.0.1:7780").replace(/\/+$/, "");
  const response = await fetch(
    `${base}/api/content/v1/extensions/${encodeURIComponent(pluginId)}/views/${encodeURIComponent(viewId)}/page${localeQuery}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "x-forwarded-host": host,
        ...(visitorIp && isIP(visitorIp) !== 0 ? { "x-forwarded-for": visitorIp } : {}),
        ...(siteCookie ? { cookie: siteCookie } : {}),
      },
    },
  );
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error("Public extension view unavailable");
  const parsed = ExtensionPublicPageResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.pluginId !== pluginId ||
      parsed.data.viewId !== viewId) return null;
  return parsed.data;
}

/** Host-bound view admission for detail pages. Unlike /page this endpoint
 * never executes the plugin's public route or enumerates course storage. */
async function loadPublicExtensionIdentity(
  pluginId: string, viewId: string, locale: string,
) {
  if (!PLUGIN_SEGMENT.test(pluginId) || !SEGMENT.test(viewId) ||
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) return null;
  const incoming = await headers();
  const host = incoming.get("host");
  if (!host || !isValidPublicHost(host)) {
    throw new Error("Public extension hostname unavailable");
  }
  const cookie = incoming.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith("vb_site_auth="));
  const ip = incoming.get("x-real-ip");
  const base = (process.env.API_URL || "http://127.0.0.1:7780").replace(/\\/+$/, "");
  const response = await fetch(
    `${base}/api/content/v1/extensions/${encodeURIComponent(pluginId)}/views/${encodeURIComponent(viewId)}/identity?locale=${encodeURIComponent(locale)}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "x-forwarded-host": host,
        ...(ip && isIP(ip) !== 0 ? { "x-forwarded-for": ip } : {}),
        ...(cookie ? { cookie } : {}),
      },
    },
  );
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error("Public extension view identity unavailable");
  const result = ExtensionPublicViewIdentitySchema.safeParse(await response.json());
  return result.success && result.data.pluginId === pluginId &&
    result.data.viewId === viewId && result.data.locale === locale
    ? result.data : null;
}
export const getPublicExtensionIdentity =
  typeof cache === "function" ? cache(loadPublicExtensionIdentity) : loadPublicExtensionIdentity;

/** React request-local memoization in Next SSR; unsupported test shims use
 * the same uncached handler, never a module/global cross-publication cache. */
export const getPublicExtensionPage =
  typeof cache === "function" ? cache(loadPublicExtensionPage) : loadPublicExtensionPage;
