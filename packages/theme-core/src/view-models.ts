import { routes } from "./route-contract";

export interface AuthorViewModel {
  id: string;
  name: string;
  slug: string;
  bio?: string | null | undefined;
  avatar?: string | null | undefined;
  url: string;
}

export interface TagViewModel {
  id: string;
  name: string;
  slug: string;
  description?: string | null | undefined;
  featureImage?: string | null | undefined;
  url: string;
}

export interface ImageViewModel {
  url: string;
  alt?: string | null | undefined;
  caption?: string | null | undefined;
}

export interface SeoViewModel {
  title: string;
  description: string;
  canonicalUrl?: string | null | undefined;
  ogImage?: string | null | undefined;
  ogType?: string | undefined;
}

export interface PostViewModel {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null | undefined;
  html: string;
  publishedAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
  readingTimeMinutes?: number | undefined;
  featured: boolean;
  featureImage?: ImageViewModel | null | undefined;
  primaryAuthor?: AuthorViewModel | null | undefined;
  authors: AuthorViewModel[];
  tags: TagViewModel[];
  url: string;
  seo: SeoViewModel;
}

export interface PageViewModel {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null | undefined;
  html: string;
  publishedAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
  featureImage?: ImageViewModel | null | undefined;
  primaryAuthor?: AuthorViewModel | null | undefined;
  url: string;
  seo: SeoViewModel;
}

export interface SiteNavigationItemViewModel {
  label: string;
  url: string;
}

export interface SiteViewModel {
  title: string;
  description: string;
  tagline?: string | null | undefined;
  url: string;
  locale: string;
  direction: "ltr" | "rtl";
  timezone: string;
  accentColor: string;
  icon?: string | null | undefined;
  logo?: string | null | undefined;
  coverImage?: string | null | undefined;
  navigation: {
    primary: SiteNavigationItemViewModel[];
    secondary: SiteNavigationItemViewModel[];
  };
  announcement?: {
    enabled: boolean;
    text: string;
    url?: string | null | undefined;
  } | undefined;
  comments?: {
    commentAccess?: string | undefined;
    preModeration?: boolean | undefined;
  } | undefined;
}

export interface PaginationViewModel {
  page: number;
  limit: number;
  total: number;
  pages: number;
  previous: number | null;
  next: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface ThemeHomeContext {
  site: SiteViewModel;
  posts: PostViewModel[];
  tags: TagViewModel[];
  pagination: PaginationViewModel;
  settings: Record<string, unknown>;
  theme: {
    id: string;
    version: string;
  };
}

export interface ThemePostContext {
  site: SiteViewModel;
  post: PostViewModel;
  settings: Record<string, unknown>;
  theme: {
    id: string;
    version: string;
  };
}

export interface ThemePageContext {
  site: SiteViewModel;
  page: PageViewModel;
  settings: Record<string, unknown>;
  theme: {
    id: string;
    version: string;
  };
}

export interface ThemeTagContext {
  site: SiteViewModel;
  tag: TagViewModel;
  posts: PostViewModel[];
  pagination: PaginationViewModel;
  settings: Record<string, unknown>;
  theme: {
    id: string;
    version: string;
  };
}

export interface ThemeAuthorContext {
  site: SiteViewModel;
  author: AuthorViewModel;
  posts: PostViewModel[];
  pagination: PaginationViewModel;
  settings: Record<string, unknown>;
  theme: {
    id: string;
    version: string;
  };
}

// ----------------- Mappers -----------------

export function mapAuthorToViewModel(
  author: {
    id?: string | undefined;
    name?: string | undefined;
    slug?: string | undefined;
    bio?: string | null | undefined;
    avatarUrl?: string | null | undefined;
    avatar?: string | null | undefined;
  } | null | undefined,
): AuthorViewModel | null {
  if (!author || !author.slug) return null;
  return {
    id: author.id || author.slug,
    name: author.name || author.slug,
    slug: author.slug,
    bio: author.bio ?? null,
    avatar: author.avatarUrl || author.avatar || null,
    url: routes.author(author.slug),
  };
}

export function mapTagToViewModel(
  tag: {
    id?: string | undefined;
    name?: string | undefined;
    slug?: string | undefined;
    description?: string | null | undefined;
    featureImageUrl?: string | null | undefined;
    featureImage?: string | null | undefined;
  } | null | undefined,
): TagViewModel | null {
  if (!tag || !tag.slug) return null;
  return {
    id: tag.id || tag.slug,
    name: tag.name || tag.slug,
    slug: tag.slug,
    description: tag.description ?? null,
    featureImage: tag.featureImageUrl || tag.featureImage || null,
    url: routes.tag(tag.slug),
  };
}

export function mapPaginationToViewModel(pagination: {
  page?: number | undefined;
  limit?: number | undefined;
  total?: number | undefined;
  pages?: number | undefined;
}): PaginationViewModel {
  const page = pagination.page && pagination.page > 0 ? pagination.page : 1;
  const limit = pagination.limit && pagination.limit > 0 ? pagination.limit : 10;
  const total = pagination.total && pagination.total >= 0 ? pagination.total : 0;
  const pages =
    pagination.pages && pagination.pages > 0
      ? pagination.pages
      : Math.max(1, Math.ceil(total / limit));
  const hasPrevious = page > 1;
  const hasNext = page < pages;

  return {
    page,
    limit,
    total,
    pages,
    previous: hasPrevious ? page - 1 : null,
    next: hasNext ? page + 1 : null,
    hasPrevious,
    hasNext,
  };
}

export function mapSiteToViewModel(site: {
  title?: string | undefined;
  description?: string | undefined;
  tagline?: string | null | undefined;
  url?: string | undefined;
  locale?: string | undefined;
  accentColor?: string | undefined;
  timezone?: string | undefined;
  iconUrl?: string | null | undefined;
  logoUrl?: string | null | undefined;
  coverUrl?: string | null | undefined;
  primaryNav?: Array<{ label: string; url: string }> | undefined;
  secondaryNav?: Array<{ label: string; url: string }> | undefined;
  announcementEnabled?: boolean | undefined;
  announcementText?: string | null | undefined;
  announcementUrl?: string | null | undefined;
  comments?: {
    commentAccess?: string | undefined;
    preModeration?: boolean | undefined;
  } | undefined;
}): SiteViewModel {
  const locale = site.locale || "en";
  const rtlLocales = ["ar", "he", "fa", "ur"];
  const direction: "ltr" | "rtl" = rtlLocales.some((r) =>
    locale.toLowerCase().startsWith(r),
  )
    ? "rtl"
    : "ltr";

  return {
    title: site.title || "Vibress",
    description: site.description || "Publishing Platform",
    tagline: site.tagline ?? null,
    url: site.url || "http://localhost:7778",
    locale,
    direction,
    timezone: site.timezone || "UTC",
    accentColor: site.accentColor || "#6366f1",
    icon: site.iconUrl ?? null,
    logo: site.logoUrl ?? null,
    coverImage: site.coverUrl ?? null,
    navigation: {
      primary: Array.isArray(site.primaryNav) ? site.primaryNav : [],
      secondary: Array.isArray(site.secondaryNav) ? site.secondaryNav : [],
    },
    announcement: {
      enabled: Boolean(site.announcementEnabled),
      text: site.announcementText || "",
      url: site.announcementUrl ?? null,
    },
    comments: site.comments,
  };
}

export function mapPostToViewModel(
  post: {
    id?: string | undefined;
    title?: string | undefined;
    slug?: string | undefined;
    excerpt?: string | null | undefined;
    html?: string | undefined;
    contentHtml?: string | undefined;
    publishedAt?: string | Date | null | undefined;
    updatedAt?: string | Date | null | undefined;
    readingTimeMinutes?: number | undefined;
    featured?: boolean | undefined;
    featureImage?: { url?: string | undefined; alt?: string | null | undefined; caption?: string | null | undefined } | string | null | undefined;
    primaryAuthor?: any;
    authors?: any[] | undefined;
    tags?: any[] | undefined;
    seo?: {
      title?: string | undefined;
      description?: string | undefined;
      canonicalUrl?: string | null | undefined;
      ogImage?: string | null | undefined;
      ogType?: string | undefined;
    } | undefined;
  },
  siteUrl?: string,
): PostViewModel {
  const slug = post.slug || "";
  const authors = Array.isArray(post.authors)
    ? (post.authors.map(mapAuthorToViewModel).filter(Boolean) as AuthorViewModel[])
    : [];
  const primaryAuthor =
    mapAuthorToViewModel(post.primaryAuthor) || (authors.length > 0 ? authors[0] : null);

  const tags = Array.isArray(post.tags)
    ? (post.tags.map(mapTagToViewModel).filter(Boolean) as TagViewModel[])
    : [];

  let featureImageObj: ImageViewModel | null = null;
  if (typeof post.featureImage === "string" && post.featureImage.trim() !== "") {
    featureImageObj = { url: post.featureImage, alt: post.title || "" };
  } else if (post.featureImage && typeof post.featureImage === "object" && post.featureImage.url) {
    featureImageObj = {
      url: post.featureImage.url,
      alt: post.featureImage.alt ?? post.title ?? "",
      caption: post.featureImage.caption ?? null,
    };
  }

  const publishedAtStr = post.publishedAt
    ? typeof post.publishedAt === "string"
      ? post.publishedAt
      : post.publishedAt.toISOString()
    : null;

  const updatedAtStr = post.updatedAt
    ? typeof post.updatedAt === "string"
      ? post.updatedAt
      : post.updatedAt.toISOString()
    : null;

  const title = post.title || "";
  const postUrl = routes.post(slug);

  return {
    id: post.id || slug,
    title,
    slug,
    excerpt: post.excerpt ?? null,
    html: post.html || post.contentHtml || "",
    publishedAt: publishedAtStr,
    updatedAt: updatedAtStr,
    readingTimeMinutes: post.readingTimeMinutes ?? 1,
    featured: Boolean(post.featured),
    featureImage: featureImageObj,
    primaryAuthor: primaryAuthor ?? null,
    authors,
    tags,
    url: postUrl,
    seo: {
      title: post.seo?.title || title,
      description: post.seo?.description || post.excerpt || "",
      canonicalUrl: post.seo?.canonicalUrl || (siteUrl ? `${siteUrl.replace(/\/+$/, "")}${postUrl}` : postUrl),
      ogImage: post.seo?.ogImage || featureImageObj?.url || null,
      ogType: post.seo?.ogType || "article",
    },
  };
}

export function mapPageToViewModel(
  page: {
    id?: string | undefined;
    title?: string | undefined;
    slug?: string | undefined;
    excerpt?: string | null | undefined;
    html?: string | undefined;
    contentHtml?: string | undefined;
    publishedAt?: string | Date | null | undefined;
    updatedAt?: string | Date | null | undefined;
    featureImage?: { url?: string | undefined; alt?: string | null | undefined; caption?: string | null | undefined } | string | null | undefined;
    primaryAuthor?: any;
    seo?: {
      title?: string | undefined;
      description?: string | undefined;
      canonicalUrl?: string | null | undefined;
      ogImage?: string | null | undefined;
      ogType?: string | undefined;
    } | undefined;
  },
  siteUrl?: string,
): PageViewModel {
  const slug = page.slug || "";
  const primaryAuthor = mapAuthorToViewModel(page.primaryAuthor);

  let featureImageObj: ImageViewModel | null = null;
  if (typeof page.featureImage === "string" && page.featureImage.trim() !== "") {
    featureImageObj = { url: page.featureImage, alt: page.title || "" };
  } else if (page.featureImage && typeof page.featureImage === "object" && page.featureImage.url) {
    featureImageObj = {
      url: page.featureImage.url,
      alt: page.featureImage.alt ?? page.title ?? "",
      caption: page.featureImage.caption ?? null,
    };
  }

  const publishedAtStr = page.publishedAt
    ? typeof page.publishedAt === "string"
      ? page.publishedAt
      : page.publishedAt.toISOString()
    : null;

  const updatedAtStr = page.updatedAt
    ? typeof page.updatedAt === "string"
      ? page.updatedAt
      : page.updatedAt.toISOString()
    : null;

  const title = page.title || "";
  const pageUrl = routes.page(slug);

  return {
    id: page.id || slug,
    title,
    slug,
    excerpt: page.excerpt ?? null,
    html: page.html || page.contentHtml || "",
    publishedAt: publishedAtStr,
    updatedAt: updatedAtStr,
    featureImage: featureImageObj,
    primaryAuthor: primaryAuthor ?? null,
    url: pageUrl,
    seo: {
      title: page.seo?.title || title,
      description: page.seo?.description || page.excerpt || "",
      canonicalUrl: page.seo?.canonicalUrl || (siteUrl ? `${siteUrl.replace(/\/+$/, "")}${pageUrl}` : pageUrl),
      ogImage: page.seo?.ogImage || featureImageObj?.url || null,
      ogType: page.seo?.ogType || "website",
    },
  };
}

export interface ThemeViewModelContext {
  site?: SiteViewModel | null | undefined;
  settings?: Record<string, unknown> | null | undefined;
  posts?: PostViewModel[] | null | undefined;
  post?: PostViewModel | null | undefined;
  page?: PageViewModel | null | undefined;
  tags?: TagViewModel[] | null | undefined;
  tag?: TagViewModel | null | undefined;
  author?: AuthorViewModel | null | undefined;
  pagination?: PaginationViewModel | null | undefined;
  theme?: {
    id: string;
    version: string;
  } | null | undefined;
  [key: string]: unknown;
}
