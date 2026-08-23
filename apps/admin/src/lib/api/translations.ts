import { apiRequest } from "./client";

export interface TranslationLocaleStatus {
  status: "untranslated" | "draft" | "in_progress" | "needs_review" | "approved" | "published" | "stale";
  translationId: string | null;
  slug: string | null;
  title: string | null;
  translatedAt: string | null;
  updatedAt: string | null;
  translationProvider: string | null;
  assignedTranslatorId: string | null;
  isStale: boolean;
}

export interface TranslationMatrixItem {
  id: string;
  title: string;
  slug: string;
  contentType: "post" | "page";
  sourceLocale: string;
  sourceStatus: string;
  sourceUpdatedAt: string;
  locales: Record<string, TranslationLocaleStatus>;
}

export interface TranslationMatrixResponse {
  items: TranslationMatrixItem[];
  total: number;
  enabledLocales: string[];
  defaultLocale: string;
}

export interface TranslationQueueItem {
  id: string;
  translationId: string | null;
  contentType: "post" | "page";
  contentId: string;
  contentTitle: string;
  sourceLocale: string;
  targetLocale: string;
  status: string;
  reason: "stale_published" | "needs_review" | "missing";
  sourceUpdatedAt: string;
  translatedAt: string | null;
  translationProvider: string | null;
}

export interface TranslationQueueResponse {
  stale: TranslationQueueItem[];
  needsReview: TranslationQueueItem[];
  missing: TranslationQueueItem[];
  totalCount: number;
}

export interface LocalizationHealthMetrics {
  totalSourceItems: number;
  totalTranslations: number;
  publishedCount: number;
  staleCount: number;
  needsReviewCount: number;
  missingCount: number;
  overallCoveragePercentage: number;
  byLocale: Record<
    string,
    {
      locale: string;
      totalSource: number;
      translated: number;
      published: number;
      stale: number;
      needsReview: number;
      missing: number;
      coveragePercentage: number;
    }
  >;
}

export interface ContentTranslationDetail {
  translation: {
    id: string;
    translationGroupId: string | null;
    contentType: string;
    contentId: string;
    sourceLocale: string;
    targetLocale: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: Record<string, unknown>;
    metaTitle: string | null;
    metaDescription: string | null;
    status: string;
    translationProvider: string | null;
    assignedTranslatorId: string | null;
    translationDueDate: string | null;
    isStale: boolean;
    fieldDiff?: {
      hasChanges: boolean;
      changedFields: string[];
      titleChanged: boolean;
      excerptChanged: boolean;
      contentChanged: boolean;
      metaTitleChanged: boolean;
      metaDescriptionChanged: boolean;
    } | undefined;
    translatedAt: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
  source: {
    title: string;
    slug: string;
    excerpt: string | null;
    content: unknown;
    updatedAt: string;
  } | null;
}

export async function fetchTranslationMatrix(params?: {
  contentType?: string | undefined;
  search?: string | undefined;
  locale?: string | undefined;
  status?: string | undefined;
  onlyStale?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<TranslationMatrixResponse> {
  const query = new URLSearchParams();
  if (params?.contentType) query.set("contentType", params.contentType);
  if (params?.search) query.set("search", params.search);
  if (params?.locale) query.set("locale", params.locale);
  if (params?.status) query.set("status", params.status);
  if (params?.onlyStale) query.set("onlyStale", "true");
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));

  const qs = query.toString();
  return apiRequest<TranslationMatrixResponse>(`/translations/matrix${qs ? `?${qs}` : ""}`);
}

export async function fetchTranslationQueue(): Promise<TranslationQueueResponse> {
  return apiRequest<TranslationQueueResponse>("/translations/queue");
}

export async function fetchLocalizationHealth(): Promise<LocalizationHealthMetrics> {
  return apiRequest<LocalizationHealthMetrics>("/translations/health");
}

export async function fetchTranslationDetail(
  id: string,
): Promise<ContentTranslationDetail> {
  return apiRequest<ContentTranslationDetail>(`/translations/${id}`);
}

export async function fetchContentTranslations(
  contentType: string,
  contentId: string,
): Promise<{ translations: ContentTranslationDetail["translation"][] }> {
  return apiRequest<{ translations: ContentTranslationDetail["translation"][] }>(
    `/content/${contentType}/${contentId}/translations`,
  );
}

export async function createContentTranslation(
  contentType: string,
  contentId: string,
  data: {
    targetLocale: string;
    title: string;
    slug: string;
    excerpt?: string | undefined;
    content?: Record<string, unknown> | undefined;
    metaTitle?: string | undefined;
    metaDescription?: string | undefined;
    status?: string | undefined;
    translationProvider?: string | undefined;
  },
): Promise<{ translation: ContentTranslationDetail["translation"] }> {
  return apiRequest<{ translation: ContentTranslationDetail["translation"] }>(
    `/content/${contentType}/${contentId}/translations`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export async function updateTranslationApi(
  id: string,
  data: {
    title?: string | undefined;
    slug?: string | undefined;
    excerpt?: string | undefined;
    content?: Record<string, unknown> | undefined;
    metaTitle?: string | undefined;
    metaDescription?: string | undefined;
    status?: string | undefined;
    translationProvider?: string | undefined;
  },
): Promise<{ translation: ContentTranslationDetail["translation"] }> {
  return apiRequest<{ translation: ContentTranslationDetail["translation"] }>(
    `/translations/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export async function submitTranslationForReview(
  id: string,
): Promise<{ translation: ContentTranslationDetail["translation"] }> {
  return apiRequest<{ translation: ContentTranslationDetail["translation"] }>(
    `/translations/${id}/submit-review`,
    {
      method: "POST",
    },
  );
}

export async function approveTranslationApi(
  id: string,
): Promise<{ translation: ContentTranslationDetail["translation"] }> {
  return apiRequest<{ translation: ContentTranslationDetail["translation"] }>(
    `/translations/${id}/approve`,
    {
      method: "POST",
    },
  );
}

export async function publishTranslationApi(
  id: string,
): Promise<{ translation: ContentTranslationDetail["translation"] }> {
  return apiRequest<{ translation: ContentTranslationDetail["translation"] }>(
    `/translations/${id}/publish`,
    {
      method: "POST",
    },
  );
}

export async function aiTranslateContent(
  contentType: string,
  contentId: string,
  data: {
    targetLocale: string;
    provider?: string | undefined;
    model?: string | undefined;
  },
): Promise<{
  translation: ContentTranslationDetail["translation"];
  message: string;
}> {
  return apiRequest<{
    translation: ContentTranslationDetail["translation"];
    message: string;
  }>(`/content/${contentType}/${contentId}/ai-translate`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function bulkUpdateTranslationsApi(data: {
  translationIds: string[];
  action: "submit_review" | "approve" | "publish" | "mark_stale" | "delete";
}): Promise<{ updatedCount: number; errors: string[] }> {
  return apiRequest<{ updatedCount: number; errors: string[] }>("/translations/bulk", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
