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
  const pageObj = await ContentApiClient.getPageBySlug(slug);
  if (!pageObj) {
    return {
      title: "Page Not Found",
    };
  }

  return buildPageMetadata({
    title: pageObj.seo?.title || pageObj.title,
    description: pageObj.seo?.description || pageObj.excerpt || "",
    canonicalPath: `/pages/${pageObj.slug}`,
    canonicalOverride: pageObj.seo?.canonicalUrl || null,
    ogImage: pageObj.seo?.ogImage || null,
    ogType: "website",
  });
}

export default async function StaticPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pageObj = await ContentApiClient.getPageBySlug(slug);
  if (!pageObj) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );
  const site = await getThemeSiteSettings();

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
