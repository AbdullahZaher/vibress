import { z } from "zod";

/**
 * Content locales enabled for one authoritative publication.
 * The primary locale is selected explicitly; a second locale is never added
 * by default. The service also validates canonical uniqueness.
 */
export const PublicationLocaleTagSchema = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/, "Invalid locale tag")
  .refine((locale) => {
    try {
      return Intl.getCanonicalLocales(locale).length === 1;
    } catch {
      return false;
    }
  }, "Invalid locale tag");

export const UpdatePublicationLocalesSchema = z.object({
  primaryLocale: PublicationLocaleTagSchema,
  enabledLocales: z.array(PublicationLocaleTagSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  const primary = Intl.getCanonicalLocales(value.primaryLocale)[0];
  const canonical = value.enabledLocales.map((locale) => Intl.getCanonicalLocales(locale)[0]);
  if (!canonical.includes(primary)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["enabledLocales"],
      message: "Enabled languages must include the primary language",
    });
  }
  if (new Set(canonical).size !== canonical.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["enabledLocales"],
      message: "Languages must be unique",
    });
  }
});
export type UpdatePublicationLocalesInput = z.infer<typeof UpdatePublicationLocalesSchema>;

export const PublicationLocalesResponseSchema = z.object({
  primaryLocale: z.string(),
  enabledLocales: z.array(z.string()),
  isMultilingual: z.boolean(),
  needsReconciliation: z.boolean(),
});
export type PublicationLocalesResponse = z.infer<typeof PublicationLocalesResponseSchema>;

/** Translation writes do not accept arbitrary publication or source IDs. */
export const CreateContentTranslationSchema = z.object({
  targetLocale: PublicationLocaleTagSchema,
  title: z.string().trim().min(1).max(500),
  slug: z.string().trim().min(1).max(500),
  excerpt: z.string().max(20000).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  metaTitle: z.string().max(500).optional(),
  metaDescription: z.string().max(2000).optional(),
  status: z.enum(["draft", "in_progress", "translated", "needs_review"]).optional(),
  translationProvider: z.string().max(100).optional(),
}).strict();

export const EditContentTranslationSchema = CreateContentTranslationSchema.omit({
  targetLocale: true,
}).partial().extend({
  // Older Studio clients still send this immutable value on PATCH.
  targetLocale: PublicationLocaleTagSchema.optional(),
  // Workflow changes are checked against the stored status in the route.
  status: z.enum(["untranslated", "draft", "in_progress", "translated", "needs_review", "approved", "published", "stale"]).optional(),
}).strict();

export const AiTranslateContentSchema = z.object({
  targetLocale: PublicationLocaleTagSchema,
  provider: z.string().max(80).optional(),
  model: z.string().max(100).optional(),
}).strict();

export const BulkTranslationActionSchema = z.object({
  translationIds: z.array(z.string().min(1).max(200)).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate translation IDs"),
  action: z.enum(["submit_review", "approve", "publish", "mark_stale", "delete"]),
}).strict();
