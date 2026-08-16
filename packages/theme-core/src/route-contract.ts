export interface RouteContract {
  home(): string;
  post(slug: string): string;
  page(slug: string): string;
  tag(slug: string): string;
  author(slug: string): string;
  portal: {
    signIn(): string;
    signUp(): string;
    account(): string;
  };
  themeAsset(themeId: string, version: string, assetPath: string): string;
}

export const routes: RouteContract = {
  home: () => "/",
  post: (slug: string) => `/posts/${encodeURIComponent(slug)}`,
  page: (slug: string) => `/pages/${encodeURIComponent(slug)}`,
  tag: (slug: string) => `/tags/${encodeURIComponent(slug)}`,
  author: (slug: string) => `/authors/${encodeURIComponent(slug)}`,
  portal: {
    signIn: () => "/portal/signin",
    signUp: () => "/portal/signup",
    account: () => "/portal/account",
  },
  themeAsset: (themeId: string, version: string, assetPath: string) => {
    const cleanPath = assetPath.replace(/^\/+/, "");
    return `/theme-assets/${encodeURIComponent(themeId)}/${encodeURIComponent(version)}/${cleanPath}`;
  },
};
