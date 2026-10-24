import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  getThemeSiteSettings, resolveThemeHostState, getPreviewThemeIdFromHeaders,
} from "../../lib/theme-host";
import { renderThemeTemplate } from "../../lib/theme-renderer";
import { mapSiteToViewModel } from "@vibress/theme-core";
import { getDirection, supportsPublishedExtensionLocale } from "@vibress/i18n";
import { getPublicExtensionPage } from "../../lib/public-extension-client";
import {
  localizedExtensionTitle,
  matchesPublicExtensionPublication,
  publicExtensionMetadata,
} from "../../lib/public-extension-page-policy";

export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublicExtensionPage("vibress-lms-authoring", "catalog");
  if (!page) return { title: "Courses", robots: { index: false, follow: false } };
  const site = await getThemeSiteSettings();
  const h = await headers();
  return publicExtensionMetadata(
    page, site, h.get("host"), process.env.NODE_ENV === "production",
    h.get("x-vibress-preview") === "true",
  );
}

export default async function CoursesCatalogPage() {
  const page = await getPublicExtensionPage("vibress-lms-authoring", "catalog");
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
        pluginId: "vibress-lms-authoring", viewId: "catalog", title, locale: site.locale,
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
