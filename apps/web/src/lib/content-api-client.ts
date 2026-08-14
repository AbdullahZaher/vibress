import {
  PublicPostSummaryDto,
  PublicPostDetailDto,
  PublicPageDetailDto,
  PublicTagDto,
  PublicAuthorDto,
} from '@vibress/api-contracts';

function getApiBaseUrl(): string {
  if (process.env.API_URL) {
    return process.env.API_URL.replace(/\/+$/, '');
  }
  if (process.env.API_PORT) {
    return `http://127.0.0.1:${process.env.API_PORT}`;
  }
  console.warn('[ContentApiClient] No API_URL or API_PORT set — falling back to http://127.0.0.1:7780 (may not work inside containers)');
  return 'http://127.0.0.1:7780';
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

async function fetchContentApi<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T | null> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/api/content/v1${path}`);

  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.append(key, String(val));
      }
    });
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error(`[ContentApiClient Error] Network failure fetching ${path}:`, error);
    return null;
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    console.error(`[ContentApiClient Error] ${res.status} from ${path}`);
    return null;
  }

  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface PaginatedPostsResult {
  posts: PublicPostSummaryDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const ContentApiClient = {
  async getPosts(options?: {
    page?: number;
    limit?: number;
    tag?: string;
    author?: string;
  }): Promise<PaginatedPostsResult | null> {
    return fetchContentApi<PaginatedPostsResult>('/posts', options);
  },

  async getPostBySlug(slug: string): Promise<PublicPostDetailDto | null> {
    const data = await fetchContentApi<{ post: PublicPostDetailDto }>(
      `/posts/${encodeURIComponent(slug)}`
    );
    return data?.post || null;
  },

  async getPageBySlug(slug: string): Promise<PublicPageDetailDto | null> {
    const data = await fetchContentApi<{ page: PublicPageDetailDto }>(
      `/pages/${encodeURIComponent(slug)}`
    );
    return data?.page || null;
  },

  async getPages(options?: {
    page?: number;
    limit?: number;
  }): Promise<{ pages: PublicPageDetailDto[]; pagination: PaginationInfo } | null> {
    return fetchContentApi<{ pages: PublicPageDetailDto[]; pagination: PaginationInfo }>('/pages', options);
  },

  async getTags(): Promise<PublicTagDto[]> {
    const data = await fetchContentApi<{ tags: PublicTagDto[] }>('/tags');
    return data?.tags || [];
  },

  async getTagBySlug(slug: string): Promise<PublicTagDto | null> {
    const data = await fetchContentApi<{ tag: PublicTagDto }>(
      `/tags/${encodeURIComponent(slug)}`
    );
    return data?.tag || null;
  },

  async getTagPosts(
    slug: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ tag: PublicTagDto; posts: PublicPostSummaryDto[]; pagination: PaginationInfo } | null> {
    return fetchContentApi(`/tags/${encodeURIComponent(slug)}/posts`, options);
  },

  async getAuthors(): Promise<PublicAuthorDto[]> {
    const data = await fetchContentApi<{ authors: PublicAuthorDto[] }>('/authors');
    return data?.authors || [];
  },

  async getAuthorBySlug(slug: string): Promise<PublicAuthorDto | null> {
    const data = await fetchContentApi<{ author: PublicAuthorDto }>(
      `/authors/${encodeURIComponent(slug)}`
    );
    return data?.author || null;
  },

  async getAuthorPosts(
    slug: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ author: PublicAuthorDto; posts: PublicPostSummaryDto[]; pagination: PaginationInfo } | null> {
    return fetchContentApi(`/authors/${encodeURIComponent(slug)}/posts`, options);
  },
};
