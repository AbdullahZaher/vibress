import { z } from "zod";
import { PublicationLocaleTagSchema } from "./publication-locales";

export const TranslationStatusSchema = z.enum([
  "draft", "in_progress", "needs_review", "translated",
  "approved", "published", "stale",
]);

export const CreateContentTranslationSchema = z.object({
  targetLocale: PublicationLocaleTagSchema,
  title: z.string().trim().min(1).max(500),
  slug: z.string().trim().min(1).max(500),
  excerpt: z.string().max(5000).optional(),
  content: z.record(z.unknown()).optional(),
  metaTitle: z.string().max(500).optional(),
  metaDescription: z.string().max(5000).optional(),
  status: TranslationStatusSchema.optional(),
  translationProvider: z.string().max(100).optional(),
}).strict();
export type CreateContentTranslationInput = z.infer<typeof CreateContentTranslationSchema>;

export const AiTranslateRequestSchema = z.object({
  targetLocale: PublicationLocaleTagSchema,
  provider: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
}).strict();

export const UpdateContentTranslationSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  slug: z.string().trim().min(1).max(500).optional(),
  excerpt: z.string().max(5000).nullable().optional(),
  content: z.record(z.unknown()).optional(),
  metaTitle: z.string().max(500).nullable().optional(),
  metaDescription: z.string().max(5000).nullable().optional(),
  status: TranslationStatusSchema.optional(),
  translationProvider: z.string().max(100).optional(),
}).strict();

export const BulkTranslationRequestSchema = z.object({
  translationIds: z.array(z.string().min(1).max(128)).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate translation IDs"),
  action: z.enum(["submit_review", "approve", "publish", "mark_stale", "delete"]),
}).strict();
