import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  getThemeSiteSettings, resolveThemeHostState, getPreviewThemeIdFromHeaders,
} from "../../../../lib/theme-host";
import { renderThemeTemplate } from "../../../../lib/theme-renderer";
import { mapSiteToViewModel } from "@vibress/theme-core";
import { getDirection, supportsPublishedExtensionLocale } from "@vibress/i18n";
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
    h.get("x-vibress-preview") === "true",
  );
}

export default async function PublicExtensionView({ params }: Props) {
  const { pluginId, viewId } = await params;
  const page = await getPublicExtensionPage(pluginId, viewId);
  if (!page) notFound();
  const site = await getThemeSiteSettings();
  if (!matchesPublicExtensionPublication(page, site) ||
      (page.locale && page.locale !== site.locale) ||
      !supportsPublishedExtensionLocale(page.publishedLocales, site.locale)) notFound();
  const title = localizedExtensionTitle(page.title, site.locale);
  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const theme = await resolveThemeHostState(!!previewThemeId, previewThemeId);
  return renderThemeTemplate(
    "extension",
    {
      extension: {
        pluginId, viewId, title, locale: site.locale,
        direction: getDirection(site.locale),
        data: { ...page.data },
      },
      site: mapSiteToViewModel(site),
      settings: theme.settings,
    },
    {
      themeId: theme.themeId, themeVersion: theme.themeVersion,
      isBuiltIn: theme.isBuiltIn, site, settings: theme.settings,
    },
  );
}
