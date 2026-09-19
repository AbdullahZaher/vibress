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
import {
  mapSiteToViewModel,
  mapPaginationToViewModel,
  buildCollectionEntryViewModel,
} from "@vibress/theme-core";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ modelSlug: string }>;
}): Promise<Metadata> {
  const { modelSlug } = await params;
  const site = await getThemeSiteSettings();
  const res = await ContentApiClient.getCollection(modelSlug, {
    locale: site.locale,
  });

  if (!res || !res.meta?.model) {
    return {
      title: "Collection Not Found",
    };
  }

  const model = res.meta.model;
  const localePrefix = getLocalePrefix(site.locale);

  return buildPageMetadata({
    title: `${model.name} | ${site.title}`,
    description: model.description || `Browse ${model.name} on ${site.title}`,
    canonicalPath: `${localePrefix}/collections/${model.slug}`,
    canonicalOverride: null,
    ogImage: null,
    ogType: "website",
    locale: site.locale,
  });
}

export default async function CollectionListingPage({
  params,
}: {
  params: Promise<{ modelSlug: string }>;
}) {
  const { modelSlug } = await params;
  const site = await getThemeSiteSettings();
  const res = await ContentApiClient.getCollection(modelSlug, {
    locale: site.locale,
  });

  if (!res || !res.meta?.model) {
    notFound();
  }

  const model = res.meta.model;
  const entryViewModels = res.data.map((item) =>
    buildCollectionEntryViewModel(
      {
        id: item.id,
        modelSlug: item.modelSlug || model.slug,
        title: item.title,
        slug: item.slug,
        data: item.data,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
      site.locale,
    ),
  );

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );

  const limit = res.meta.pagination.limit || 20;
  const total = res.meta.pagination.count || entryViewModels.length;

  return renderThemeTemplate(
    "collection",
    {
      site: mapSiteToViewModel(site),
      collection: {
        model: {
          name: model.name,
          slug: model.slug,
          description: model.description ?? null,
        },
        entries: entryViewModels,
      },
      collections: {
        [model.slug]: entryViewModels,
      },
      pagination: mapPaginationToViewModel({
        page: 1,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      }),
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
