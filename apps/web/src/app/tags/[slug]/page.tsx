import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { ContentApiClient } from '../../../lib/content-api-client';
import { buildPageMetadata } from '../../../lib/seo-helpers';
import {
  resolveThemeHostState,
  getThemeSiteSettings,
  getPreviewThemeIdFromHeaders,
} from '../../../lib/theme-host';

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tag = await ContentApiClient.getTagBySlug(slug);
  if (!tag) {
    return {
      title: 'Tag Not Found',
    };
  }

  return buildPageMetadata({
    title: `Posts tagged #${tag.name}`,
    description: tag.description || `Browse articles tagged #${tag.name}`,
    canonicalPath: `/tags/${tag.slug}`,
  });
}

export default async function TagArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const pageNum = sp?.page ? parseInt(sp.page, 10) : 1;
  const validPage = isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;

  const result = await ContentApiClient.getTagPosts(slug, {
    page: validPage,
    limit: 10,
  });

  if (!result || !result.tag) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(!!previewThemeId, previewThemeId);
  const site = getThemeSiteSettings();

  return hostState.theme.components.TagArchive({
    tag: result.tag,
    posts: result.posts,
    pagination: result.pagination,
    site,
    settings: hostState.settings,
  });
}
