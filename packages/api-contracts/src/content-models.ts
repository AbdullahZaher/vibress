import { z } from "zod";

export const ContentModelFieldSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  key: z.string().trim().min(1).max(255),
  type: z.enum([
    "text", "short_text", "long_text", "rich_text", "studio_doc",
    "number", "boolean", "date", "datetime", "url", "email",
    "select", "multi_select", "media", "taxonomy", "relation",
    "relation_list", "json",
  ]),
  required: z.boolean().optional(),
  localizable: z.boolean().optional(),
  apiVisibility: z.enum(["public", "authenticated", "private"]).optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
  })).optional(),
  relationModel: z.string().optional(),
}).passthrough();

export const CreateContentModelSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().max(255).optional(),
  description: z.string().max(10000).optional(),
  fields: z.array(ContentModelFieldSchema).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
}).passthrough();
export const UpdateContentModelSchema = CreateContentModelSchema.partial();
export const PreviewContentModelSchema = z.object({
  fields: z.array(ContentModelFieldSchema).max(100),
});
export const CreateCollectionEntrySchema = z.object({
  title: z.string().trim().min(1).max(255),
  slug: z.string().max(255).optional(),
  data: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "published"]).optional(),
}).passthrough();
export const UpdateCollectionEntrySchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  slug: z.string().max(255).optional(),
  data: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  expectedVersion: z.number().int().positive().optional(),
}).passthrough();
export const CollectionEntriesQuerySchema = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  limit: z.string().regex(/^\d+$/).max(3).refine((value) => Number(value) >= 1 && Number(value) <= 100).optional(),
  offset: z.string().regex(/^\d+$/).max(10).refine((value) => Number.isSafeInteger(Number(value))).optional(),
  search: z.string().max(255).optional(),
  includeRelations: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "publishedAt", "title", "slug"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
}).passthrough();
