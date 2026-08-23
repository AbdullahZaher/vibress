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
import { mapPostToViewModel, mapSiteToViewModel } from "@vibress/theme-core";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await getThemeSiteSettings();
  const post = await ContentApiClient.getPostBySlug(slug, { locale: site.locale });
  if (!post) {
    return {
      title: "Post Not Found",
    };
  }

  const localePrefix = getLocalePrefix(site.locale);

  return buildPageMetadata({
    title: post.seo?.title || post.title,
    description: post.seo?.description || post.excerpt || "",
    canonicalPath: `${localePrefix}/posts/${post.slug}`,
    canonicalOverride: post.seo?.canonicalUrl || null,
    ogImage: post.featureImage?.url || post.seo?.ogImage || null,
    ogType: "article",
    locale: site.locale,
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getThemeSiteSettings();
  const post = await ContentApiClient.getPostBySlug(slug, { locale: site.locale });
  if (!post) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );

  return renderThemeTemplate(
    "post",
    {
      post: mapPostToViewModel(post as any),
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
