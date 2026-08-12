import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { ContentApiClient } from '../../../lib/content-api-client';
import {
  buildPageMetadata,
  buildPostJsonLd,
  safeJsonLdScript,
} from '../../../lib/seo-helpers';
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
  const post = await ContentApiClient.getPostBySlug(slug);
  if (!post) {
    return {
      title: 'Post Not Found',
    };
  }

  return buildPageMetadata({
    title: post.seo?.title || post.title,
    description: post.seo?.description || post.excerpt || '',
    canonicalPath: `/posts/${post.slug}`,
    canonicalOverride: post.seo?.canonicalUrl || null,
    ogImage: post.featureImage?.url || post.seo?.ogImage || null,
    ogType: 'article',
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await ContentApiClient.getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(!!previewThemeId, previewThemeId);
  const site = await getThemeSiteSettings();

  return hostState.theme.components.Post({
    post,
    site,
    settings: hostState.settings,
  });
}
