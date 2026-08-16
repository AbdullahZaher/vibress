import { ContentApiClient } from "../lib/content-api-client";
import {
  resolveThemeHostState,
  getThemeSiteSettings,
  getPreviewThemeIdFromHeaders,
} from "../lib/theme-host";
import { renderThemeTemplate } from "../lib/theme-renderer";
import {
  mapPostToViewModel,
  mapTagToViewModel,
  mapPaginationToViewModel,
  mapSiteToViewModel,
} from "@vibress/theme-core";

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
  const hostState = await resolveThemeHostState(
    !!previewThemeId,
    previewThemeId,
  );

  const [postsData, tags] = await Promise.all([
    ContentApiClient.getPosts({ page: validPage, limit: 10 }),
    ContentApiClient.getTags(),
  ]);

  const posts = postsData?.posts || [];
  const pagination = postsData?.pagination || {
    page: 1,
    limit: 10,
    total: 0,
    pages: 1,
  };

  const site = await getThemeSiteSettings();

  return renderThemeTemplate(
    "home",
    {
      posts: posts.map((p) => mapPostToViewModel(p as any)),
      tags: tags
        .map((t) => mapTagToViewModel(t as any))
        .filter((t): t is NonNullable<typeof t> => t !== null),
      pagination: mapPaginationToViewModel(pagination),
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
