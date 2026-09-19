export interface RouteContract {
  home(locale?: string): string;
  post(slug: string, locale?: string): string;
  page(slug: string, locale?: string): string;
  tag(slug: string, locale?: string): string;
  author(slug: string, locale?: string): string;
  collection(modelSlug: string, locale?: string): string;
  collectionEntry(modelSlug: string, entrySlug: string, locale?: string): string;
  portal: {
    signIn(locale?: string): string;
    signUp(locale?: string): string;
    account(locale?: string): string;
  };
  themeAsset(themeId: string, version: string, assetPath: string): string;
  themePreview(token: string, subpath?: string): string;
}

function prefixRoute(path: string, locale?: string): string {
  if (!locale || locale === "en" || locale === "en-US") {
    return path;
  }
  const cleanPrefix = locale.toLowerCase();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (cleanPath === "/") {
    return `/${cleanPrefix}`;
  }
  return `/${cleanPrefix}${cleanPath}`;
}

export const routes: RouteContract = {
  home: (locale?: string) => prefixRoute("/", locale),
  post: (slug: string, locale?: string) =>
    prefixRoute(`/posts/${encodeURIComponent(slug)}`, locale),
  page: (slug: string, locale?: string) =>
    prefixRoute(`/pages/${encodeURIComponent(slug)}`, locale),
  tag: (slug: string, locale?: string) =>
    prefixRoute(`/tags/${encodeURIComponent(slug)}`, locale),
  author: (slug: string, locale?: string) =>
    prefixRoute(`/authors/${encodeURIComponent(slug)}`, locale),
  collection: (modelSlug: string, locale?: string) =>
    prefixRoute(`/collections/${encodeURIComponent(modelSlug)}`, locale),
  collectionEntry: (modelSlug: string, entrySlug: string, locale?: string) =>
    prefixRoute(
      `/collections/${encodeURIComponent(modelSlug)}/${encodeURIComponent(entrySlug)}`,
      locale,
    ),
  portal: {
    signIn: (locale?: string) => prefixRoute("/portal/signin", locale),
    signUp: (locale?: string) => prefixRoute("/portal/signup", locale),
    account: (locale?: string) => prefixRoute("/portal/account", locale),
  },
  themeAsset: (themeId: string, version: string, assetPath: string) => {
    const cleanPath = assetPath.replace(/^\/+/, "");
    return `/theme-assets/${encodeURIComponent(themeId)}/${encodeURIComponent(version)}/${cleanPath}`;
  },
  themePreview: (token: string, subpath = "") => {
    const cleanSubpath = subpath ? `/${subpath.replace(/^\/+/, "")}` : "";
    return `/preview/${encodeURIComponent(token)}${cleanSubpath}`;
  },
};

