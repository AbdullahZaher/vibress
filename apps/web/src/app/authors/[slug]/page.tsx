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
  const author = await ContentApiClient.getAuthorBySlug(slug);
  if (!author) {
    return {
      title: 'Author Not Found',
    };
  }

  return buildPageMetadata({
    title: `Articles by ${author.name}`,
    description: author.bio || `Browse articles published by ${author.name}`,
    canonicalPath: `/authors/${author.slug}`,
  });
}

export default async function AuthorArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const sp = await (searchParams ?? Promise.resolve<Record<string, string | undefined>>({}));
  const pageNum = sp?.page ? parseInt(sp.page, 10) : 1;
  const validPage = isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;

  const result = await ContentApiClient.getAuthorPosts(slug, {
    page: validPage,
    limit: 10,
  });

  if (!result || !result.author) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(!!previewThemeId, previewThemeId);
  const site = await getThemeSiteSettings();

  return hostState.theme.components.AuthorArchive({
    author: result.author,
    posts: result.posts,
    pagination: result.pagination,
    site,
    settings: hostState.settings,
  });
}
