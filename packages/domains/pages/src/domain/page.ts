export class PageDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PageDomainError";
    this.code = code;
  }
}

export type PageStatus = "draft" | "scheduled" | "published";
export type PageVisibility = "public" | "members" | "paid";

export interface Page {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, unknown>;
  contentVersion: number;
  status: PageStatus;
  visibility: PageVisibility;
  version: number;
  primaryAuthorId: string;
  createdBy: string;
  updatedBy: string;
  publishedBy: string | null;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreatePageData {
  id?: string | undefined;
  title: string;
  slug?: string | undefined;
  excerpt?: string | null | undefined;
  content?: Record<string, unknown> | undefined;
  contentVersion?: number | undefined;
  status?: PageStatus | undefined;
  visibility?: PageVisibility | undefined;
  primaryAuthorId: string;
  authorIds?: string[] | undefined;
  createdBy?: string | undefined;
  scheduledAt?: Date | null | undefined;
  metaTitle?: string | null | undefined;
  metaDescription?: string | null | undefined;
  canonicalUrl?: string | null | undefined;
}

export interface UpdatePageData {
  title?: string | undefined;
  slug?: string | undefined;
  excerpt?: string | null | undefined;
  content?: Record<string, unknown> | undefined;
  contentVersion?: number | undefined;
  visibility?: PageVisibility | undefined;
  primaryAuthorId?: string | undefined;
  authorIds?: string[] | undefined;
  expectedVersion?: number | undefined;
  metaTitle?: string | null | undefined;
  metaDescription?: string | null | undefined;
  canonicalUrl?: string | null | undefined;
}

export interface ListPagesFilter {
  status?: PageStatus | undefined;
  visibility?: PageVisibility | undefined;
  publishedOnly?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
