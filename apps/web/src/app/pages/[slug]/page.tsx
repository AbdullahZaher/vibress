import { getLocalePrefix } from "@vibress/i18n";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ContentApiClient } from "../../../lib/content-api-client";
import { buildPageMetadata } from "../../../lib/seo-helpers";
import {
  resolveThemeHostState,
  getThemeSiteSettings,
  getPreviewThemeIdFromHeaders,
} from "../../../lib/theme-host";
import { renderThemeTemplate } from "../../../lib/theme-renderer";
import { mapPageToViewModel, mapSiteToViewModel } from "@vibress/theme-core";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await getThemeSiteSettings();
  const pageObj = await ContentApiClient.getPageBySlug(slug, { locale: site.locale });
  if (!pageObj) {
    return {
      title: "Page Not Found",
    };
  }

  const localePrefix = getLocalePrefix(site.locale);

  return buildPageMetadata({
    title: pageObj.seo?.title || pageObj.title,
    description: pageObj.seo?.description || pageObj.excerpt || "",
    canonicalPath: `${localePrefix}/pages/${pageObj.slug}`,
    canonicalOverride: pageObj.seo?.canonicalUrl || null,
    ogImage: pageObj.seo?.ogImage || null,
    ogType: "website",
    locale: site.locale,
  });
}

export default async function StaticPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getThemeSiteSettings();
  const pageObj = await ContentApiClient.getPageBySlug(slug, { locale: site.locale });
  if (!pageObj) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );

  return renderThemeTemplate(
    "page",
    {
      page: mapPageToViewModel(pageObj as any),
      site: mapSiteToViewModel(site),
      settings: hostState.settings,
    },
    {
      themeId: hostState.themeId,
      themeVersion: hostState.themeVersion,
      isBuiltIn: hostState.isBuiltIn,
      settings: hostState.settings,
      site,
    },
  );
}
