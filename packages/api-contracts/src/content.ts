import { z } from 'zod';

export const CreatePostInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  slug: z.string().trim().max(255).optional(),
  excerpt: z.string().max(1000).nullable().optional(),
  content: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'members', 'paid']).optional(),
  primaryAuthorId: z.string().min(1, 'Primary author ID is required'),
  authorIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  metaTitle: z.string().max(255).nullable().optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
});
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

export const UpdatePostInputSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().max(255).optional(),
  excerpt: z.string().max(1000).nullable().optional(),
  content: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'members', 'paid']).optional(),
  primaryAuthorId: z.string().optional(),
  authorIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  expectedVersion: z.number().int().positive().optional(),
  metaTitle: z.string().max(255).nullable().optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
});
export type UpdatePostInput = z.infer<typeof UpdatePostInputSchema>;

export const SchedulePostInputSchema = z.object({
  scheduledAt: z.string().datetime(),
});
export type SchedulePostInput = z.infer<typeof SchedulePostInputSchema>;

export const CreatePageInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  slug: z.string().trim().max(255).optional(),
  excerpt: z.string().max(1000).nullable().optional(),
  content: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'members', 'paid']).optional(),
  primaryAuthorId: z.string().min(1, 'Primary author ID is required'),
  authorIds: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  metaTitle: z.string().max(255).nullable().optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
});
export type CreatePageInput = z.infer<typeof CreatePageInputSchema>;

export const UpdatePageInputSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().max(255).optional(),
  excerpt: z.string().max(1000).nullable().optional(),
  content: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'members', 'paid']).optional(),
  primaryAuthorId: z.string().optional(),
  authorIds: z.array(z.string()).optional(),
  expectedVersion: z.number().int().positive().optional(),
  metaTitle: z.string().max(255).nullable().optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;

export const SchedulePageInputSchema = z.object({
  scheduledAt: z.string().datetime(),
});
export type SchedulePageInput = z.infer<typeof SchedulePageInputSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(100),
  slug: z.string().trim().max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;

export const UpdateTagInputSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});
export type UpdateTagInput = z.infer<typeof UpdateTagInputSchema>;

// Public Content DTO Schemas
export const PublicAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  bio: z.string().nullable(),
});
export type PublicAuthorDto = z.infer<typeof PublicAuthorSchema>;

export const PublicTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
});
export type PublicTagDto = z.infer<typeof PublicTagSchema>;

export const PublicMediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  alt: z.string().nullable(),
  assetType: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
export type PublicMediaDto = z.infer<typeof PublicMediaSchema>;

export const PublicSeoSchema = z.object({
  title: z.string(),
  description: z.string(),
  canonicalUrl: z.string(),
  ogImage: z.string().optional(),
  ogType: z.string().optional(),
});
export type PublicSeoDto = z.infer<typeof PublicSeoSchema>;

export const PublicPostSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  primaryAuthor: PublicAuthorSchema,
  authors: z.array(PublicAuthorSchema),
  tags: z.array(PublicTagSchema),
  featureImage: PublicMediaSchema.nullable().optional(),
  seo: PublicSeoSchema,
});
export type PublicPostSummaryDto = z.infer<typeof PublicPostSummarySchema>;

export const PublicPostDetailSchema = PublicPostSummarySchema.extend({
  content: z.record(z.any()),
  html: z.string(),
});
export type PublicPostDetailDto = z.infer<typeof PublicPostDetailSchema>;

export const PublicPageDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  content: z.record(z.any()),
  html: z.string(),
  featureImage: PublicMediaSchema.nullable().optional(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  seo: PublicSeoSchema,
});
export type PublicPageDetailDto = z.infer<typeof PublicPageDetailSchema>;

export const PublicListFilterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tag: z.string().optional(),
  author: z.string().optional(),
});
export type PublicListFilterInput = z.infer<typeof PublicListFilterSchema>;
