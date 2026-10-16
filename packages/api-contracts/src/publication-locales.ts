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
