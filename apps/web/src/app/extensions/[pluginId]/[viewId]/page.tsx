import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getThemeSiteSettings } from "../../../../lib/theme-host";
import { getPublicExtensionPage } from "../../../../lib/public-extension-client";
import {
  localizedExtensionTitle,
  matchesPublicExtensionPublication,
  publicExtensionMetadata,
} from "../../../../lib/public-extension-page-policy";

export const revalidate = 0;

type Props = {
  params: Promise<{ pluginId: string; viewId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pluginId, viewId } = await params;
  const page = await getPublicExtensionPage(pluginId, viewId);
  if (!page) return { title: "Not Found", robots: { index: false, follow: false } };
  const site = await getThemeSiteSettings();
  const h = await headers();
  return publicExtensionMetadata(
    page, site, h.get("host"), process.env.NODE_ENV === "production",
  );
}

export default async function PublicExtensionView({ params }: Props) {
  const { pluginId, viewId } = await params;
  const page = await getPublicExtensionPage(pluginId, viewId);
  if (!page) notFound();
  const site = await getThemeSiteSettings();
  if (!matchesPublicExtensionPublication(page, site)) notFound();
  const title = localizedExtensionTitle(page.title, site.locale);

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
