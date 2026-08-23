export type TranslationStatus =
  | "untranslated"
  | "draft"
  | "in_progress"
  | "translated"
  | "needs_review"
  | "approved"
  | "published"
  | "stale";

export const ALLOWED_STATUS_TRANSITIONS: Record<TranslationStatus, TranslationStatus[]> = {
  untranslated: ["draft", "in_progress", "needs_review", "translated", "approved", "published"],
  draft: ["in_progress", "needs_review", "translated", "stale", "approved", "published"],
  in_progress: ["draft", "needs_review", "translated", "stale", "approved", "published"],
  translated: ["needs_review", "approved", "published", "stale", "draft"],
  needs_review: ["approved", "in_progress", "draft", "stale", "published"],
  approved: ["published", "needs_review", "draft", "stale"],
  published: ["stale", "needs_review", "draft", "approved"],
  stale: ["in_progress", "needs_review", "approved", "published", "draft"],
};

export function validateTranslationStatusTransition(
  currentStatus: TranslationStatus,
  targetStatus: TranslationStatus,
): { valid: boolean; reason?: string } {
  if (currentStatus === targetStatus) return { valid: true };
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    return {
      valid: false,
      reason: `Invalid status transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${allowed.join(", ")}`,
    };
  }
  return { valid: true };
}

export interface FieldLevelSourceDiff {
  hasChanges: boolean;
  titleChanged: boolean;
  slugChanged: boolean;
  excerptChanged: boolean;
  contentChanged: boolean;
  metaTitleChanged: boolean;
  metaDescriptionChanged: boolean;
  changedFields: string[];
}

export interface UpsertTranslationInput {
  contentType: "post" | "page" | "content_entry" | "tag";
  contentId: string;
  translationGroupId?: string | null | undefined;
  sourceLocale?: string | undefined;
  targetLocale: string;
  title: string;
  slug: string;
  excerpt?: string | null | undefined;
  content?: Record<string, unknown> | null | undefined;
  metaTitle?: string | null | undefined;
  metaDescription?: string | null | undefined;
  status?: TranslationStatus | undefined;
  translationProvider?: string | undefined;
  assignedTranslatorId?: string | null | undefined;
  translationDueDate?: Date | null | undefined;
  sourceUpdatedAt?: Date | null | undefined;
  sourceVersion?: number | null | undefined;
  expectedSourceVersion?: number | undefined;
}

export interface ContentTranslationItem {
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
  status: TranslationStatus;
  translationProvider: string | null;
  assignedTranslatorId: string | null;
  translationDueDate: Date | null;
  sourceVersionAtTranslation: number;
  sourceUpdatedAtTranslation: Date;
  isStale: boolean;
  fieldDiff?: FieldLevelSourceDiff | undefined;
  translatedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranslationLocaleStatus {
  status: TranslationStatus;
  translationId: string | null;
  slug: string | null;
  title: string | null;
  translatedAt: Date | null;
  updatedAt: Date | null;
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
  sourceUpdatedAt: Date;
  locales: Record<string, TranslationLocaleStatus>;
}

export interface TranslationMatrixFilter {
  contentType?: "post" | "page" | "all" | undefined;
  search?: string | undefined;
  locale?: string | undefined;
  status?: string | undefined;
  onlyStale?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface TranslationQueueItem {
  id: string;
  translationId: string | null;
  contentType: "post" | "page";
  contentId: string;
  contentTitle: string;
  sourceLocale: string;
  targetLocale: string;
  status: TranslationStatus;
  reason: "stale_published" | "needs_review" | "missing";
  sourceUpdatedAt: Date;
  translatedAt: Date | null;
  translationProvider: string | null;
}

export interface LocalizationHealthMetrics {
  totalSourceItems: number;
  totalTranslations: number;
  publishedCount: number;
  staleCount: number;
  needsReviewCount: number;
  missingCount: number;
  // Canonical Metrics
  translationCoveragePercentage: number;
  publishedCoveragePercentage: number;
  reviewCoveragePercentage: number;
  staleRatePercentage: number;
  overallCoveragePercentage: number; // Aliased to publishedCoveragePercentage for backwards compatibility
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
      publishedCoveragePercentage: number;
      staleRatePercentage: number;
    }
  >;
}

export interface BulkTranslationUpdateInput {
  translationIds: string[];
  action: "submit_review" | "approve" | "publish" | "mark_stale" | "delete";
  reviewerId?: string | undefined;
}

export interface BulkTranslationResult {
  updatedCount: number;
  succeededIds: string[];
  failed: Array<{ id: string; reason: string }>;
  errors: string[];
}

export interface GlossaryTerm {
  id?: string | undefined;
  sourceTerm: string;
  targetTerm: string;
  sourceLocale: string;
  targetLocale: string;
  description?: string | undefined;
  caseSensitive?: boolean | undefined;
}
