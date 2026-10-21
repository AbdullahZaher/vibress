import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getLocalePrefix } from "@vibress/i18n";
import { getThemeSiteSettings } from "../../../../lib/theme-host";
import { getPublicExtensionPage, isValidPublicHost } from "../../../../lib/public-extension-client";
import { buildPageMetadata } from "../../../../lib/seo-helpers";

export const revalidate = 0;

type Props = {
  params: Promise<{ pluginId: string; viewId: string }>;
};

function localizedTitle(
  title: { en: string; ar: string }, locale: string,
): string {
  return /^ar(?:-|$)/i.test(locale) ? title.ar : title.en;
}

/**
 * Use the Host-resolved request domain rather than the global SITE_URL (which
 * can point at another publication). The gateway overwrites Host; publication
 * is independently validated by the API and compared with site settings.
 */
async function trustedPublicationOrigin(configuredUrl: string): Promise<string | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host || !isValidPublicHost(host)) return null;
  const defaultScheme = process.env.NODE_ENV === "production" ? "https:" : "http:";
  let protocol = defaultScheme;
  try {
    const configured = new URL(configuredUrl);
    if ((configured.protocol === "http:" || configured.protocol === "https:") &&
        configured.host.toLowerCase() === host.toLowerCase()) {
      protocol = configured.protocol;
    }
  } catch {
    // A corrupt site URL cannot override the Host-authoritative origin.
  }
  return `${protocol}//${host}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pluginId, viewId } = await params;
  const page = await getPublicExtensionPage(pluginId, viewId);
  if (!page) return { title: "Not Found", robots: { index: false, follow: false } };
  const site = await getThemeSiteSettings();
  if (!site.publicationId || site.publicationId !== page.publicationId) {
    return { robots: { index: false, follow: false } };
  }
  const origin = await trustedPublicationOrigin(site.url);
  if (!origin) return { robots: { index: false, follow: false } };
  const localePrefix = getLocalePrefix(
    site.locale, site.primaryLocale || site.locale, site.enabledLocales,
  );
  const title = localizedTitle(page.title, site.locale);
  return {
    ...buildPageMetadata({
      title, description: `${title} | ${site.title}`,
      canonicalPath: `${localePrefix}/extensions/${pluginId}/${viewId}`,
      canonicalOverride: `${origin}${localePrefix}/extensions/${pluginId}/${viewId}`,
      locale: site.locale, ogType: "website",
      // No hreflang claims until the API can prove locale-specific public
      // content is published and enabled (EXT-302B).
      alternateLocales: {},
    }),
    ...(site.security?.isPrivate ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function PublicExtensionView({ params }: Props) {
  const { pluginId, viewId } = await params;
  const page = await getPublicExtensionPage(pluginId, viewId);
  if (!page) notFound();
  const site = await getThemeSiteSettings();
  if (!site.publicationId || site.publicationId !== page.publicationId) notFound();
  const title = localizedTitle(page.title, site.locale);

  // Fallback-only, server-rendered, escaped, accessible scalar projection.
  // External theme slots and rich sanitized view-models belong to EXT-303.
  return (
    <main
      id="main-content"
      aria-label={title}
      style={{ maxWidth: "72rem", margin: "0 auto", padding: "clamp(1rem, 4vw, 3rem)" }}
    >
      <header style={{ marginBottom: "2rem" }}>
        <h1 dir="auto">{title}</h1>
      </header>
      <dl style={{ display: "grid", gap: "1rem" }}>
        {Object.entries(page.data).map(([key, value]) => (
          <div key={key} style={{ minWidth: 0 }}>
            <dt dir="auto" style={{ fontWeight: 600 }}>{key}</dt>
            <dd dir="auto" style={{ overflowWrap: "anywhere", marginInlineStart: 0 }}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
