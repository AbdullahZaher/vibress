import { getLocalePrefix } from "@vibress/i18n";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ContentApiClient } from "../../../../lib/content-api-client";
import { buildPageMetadata } from "../../../../lib/seo-helpers";
import {
  resolveThemeHostState,
  getThemeSiteSettings,
  getPreviewThemeIdFromHeaders,
} from "../../../../lib/theme-host";
import { renderThemeTemplate } from "../../../../lib/theme-renderer";
import {
  mapSiteToViewModel,
  buildCollectionEntryViewModel,
} from "@vibress/theme-core";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ modelSlug: string; entrySlug: string }>;
}): Promise<Metadata> {
  const { modelSlug, entrySlug } = await params;
  const site = await getThemeSiteSettings();
  const res = await ContentApiClient.getCollectionEntry(modelSlug, entrySlug, {
    locale: site.locale,
  });

  if (!res || !res.data) {
    return {
      title: "Entry Not Found",
    };
  }

  const entry = res.data;
  const localePrefix = getLocalePrefix(site.locale);

  return buildPageMetadata({
    title: `${entry.title} | ${site.title}`,
    description: `View ${entry.title} in ${modelSlug} on ${site.title}`,
    canonicalPath: `${localePrefix}/collections/${modelSlug}/${entry.slug}`,
    canonicalOverride: null,
    ogImage: null,
    ogType: "article",
    locale: site.locale,
  });
}

export default async function CollectionEntryDetailPage({
  params,
}: {
  params: Promise<{ modelSlug: string; entrySlug: string }>;
}) {
  const { modelSlug, entrySlug } = await params;
  const site = await getThemeSiteSettings();
  const res = await ContentApiClient.getCollectionEntry(modelSlug, entrySlug, {
    locale: site.locale,
  });

  if (!res || !res.data) {
    notFound();
  }

  const entry = res.data;
  const entryViewModel = buildCollectionEntryViewModel(
    {
      id: entry.id,
      modelSlug: entry.modelSlug || modelSlug,
      title: entry.title,
      slug: entry.slug,
      data: entry.data,
      publishedAt: entry.publishedAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
    site.locale,
  );

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );

  return renderThemeTemplate(
    "collection-entry",
    {
      site: mapSiteToViewModel(site),
      collection: {
        model: {
          name: modelSlug.replace(/-/g, " "),
          slug: modelSlug,
        },
        entries: [entryViewModel],
        entry: entryViewModel,
      },
      collections: {
        [modelSlug]: [entryViewModel],
      },
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
