import { ContentApiClient } from '../lib/content-api-client';
import {
  resolveThemeHostState,
  getThemeSiteSettings,
  getPreviewThemeIdFromHeaders,
} from '../lib/theme-host';

export const revalidate = 0;

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const pageNum = sp?.page ? parseInt(sp.page, 10) : 1;
  const validPage = isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;

  const previewThemeId = await getPreviewThemeIdFromHeaders();
  const hostState = await resolveThemeHostState(!!previewThemeId, previewThemeId);

  const [postsData, tags] = await Promise.all([
    ContentApiClient.getPosts({ page: validPage, limit: 10 }),
    ContentApiClient.getTags(),
  ]);

  const posts = postsData?.posts || [];
  const pagination = postsData?.pagination || { page: 1, limit: 10, total: 0, pages: 1 };

  const site = await getThemeSiteSettings();

  return hostState.theme.components.Home({
    posts,
    tags,
    pagination,
    site,
    settings: hostState.settings,
  });
}
