export type PostStatus = 'draft' | 'scheduled' | 'published';
export type PostVisibility = 'public' | 'members' | 'paid';

export interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, any>;
  contentVersion: number;
  status: PostStatus;
  visibility: PostVisibility;
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

export interface CreatePostData {
  id?: string | undefined;
  title: string;
  slug?: string | undefined;
  excerpt?: string | null | undefined;
  content?: Record<string, any> | undefined;
  contentVersion?: number | undefined;
  status?: PostStatus | undefined;
  visibility?: PostVisibility | undefined;
  primaryAuthorId: string;
  authorIds?: string[] | undefined;
  tagIds?: string[] | undefined;
  createdBy?: string | undefined;
  scheduledAt?: Date | null | undefined;
  metaTitle?: string | null | undefined;
  metaDescription?: string | null | undefined;
  canonicalUrl?: string | null | undefined;
}

export interface UpdatePostData {
  title?: string | undefined;
  slug?: string | undefined;
  excerpt?: string | null | undefined;
  content?: Record<string, any> | undefined;
  contentVersion?: number | undefined;
  visibility?: PostVisibility | undefined;
  primaryAuthorId?: string | undefined;
  authorIds?: string[] | undefined;
  tagIds?: string[] | undefined;
  expectedVersion?: number | undefined;
  metaTitle?: string | null | undefined;
  metaDescription?: string | null | undefined;
  canonicalUrl?: string | null | undefined;
}

export interface ListPostsFilter {
  status?: PostStatus | undefined;
  authorId?: string | undefined;
  authorSlug?: string | undefined;
  tagSlug?: string | undefined;
  publishedOnly?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sortBy?: ('createdAt' | 'updatedAt' | 'publishedAt' | 'title') | undefined;
  sortOrder?: ('asc' | 'desc') | undefined;
}
