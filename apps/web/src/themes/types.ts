import type {
  PublicAuthorDto,
  PublicPageDetailDto,
  PublicPostDetailDto,
  PublicPostSummaryDto,
  PublicTagDto,
} from "@vibress/api-contracts";
import type {
  ThemeManifest,
  ThemeSettingsSchema,
  ThemeSiteSettings,
} from "@vibress/theme-core";

export interface ThemePagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ThemeHomeProps {
  posts: PublicPostSummaryDto[];
  tags: PublicTagDto[];
  pagination: ThemePagination;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export interface ThemePostProps {
  post: PublicPostDetailDto;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export interface ThemePageProps {
  page: PublicPageDetailDto;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export interface ThemeTagArchiveProps {
  tag: PublicTagDto;
  posts: PublicPostSummaryDto[];
  pagination: ThemePagination;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export interface ThemeAuthorArchiveProps {
  author: PublicAuthorDto;
  posts: PublicPostSummaryDto[];
  pagination: ThemePagination;
  site: ThemeSiteSettings;
  settings: Record<string, unknown>;
}

export interface VibressThemeDefinition {
  manifest: ThemeManifest;
  settingsSchema: ThemeSettingsSchema;
  components: {
    Home: (
      props: ThemeHomeProps,
    ) => Promise<React.ReactElement> | React.ReactElement;
    Post: (
      props: ThemePostProps,
    ) => Promise<React.ReactElement> | React.ReactElement;
    Page: (
      props: ThemePageProps,
    ) => Promise<React.ReactElement> | React.ReactElement;
    TagArchive: (
      props: ThemeTagArchiveProps,
    ) => Promise<React.ReactElement> | React.ReactElement;
    AuthorArchive: (
      props: ThemeAuthorArchiveProps,
    ) => Promise<React.ReactElement> | React.ReactElement;
  };
  cssPath?: string;
}

export function themeSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: unknown,
): unknown {
  const value = settings[key];
  return value === undefined ? fallback : value;
}
