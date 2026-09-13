import { z } from "zod";

/**
 * Validates that a URL is a safe application relative path (/admin/...)
 * or a valid safe https:// URL without javascript/data/vbscript/file protocols.
 */
export function isSafeWhatsNewUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return true; // Optional field
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }

  // Reject explicit dangerous protocols
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("ftp:")
  ) {
    return false;
  }

  // Allow relative internal application paths (e.g. /admin/analytics)
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }

  // Allow safe external HTTPS URLs
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * SemVer format validator for schema
 */
const SemVerStringSchema = z
  .string()
  .trim()
  .regex(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    "Must be a valid semantic version",
  );

/**
 * Schema for an individual What's New item
 */
export const WhatsNewItemSchema = z.object({
  id: z.string().trim().min(1, "ID must not be empty"),
  title: z.string().trim().min(1, "Title must not be empty"),
  description: z.string().trim().min(1, "Description must not be empty"),
  publishedAt: z
    .string()
    .trim()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: "publishedAt must be a valid ISO-8601 timestamp",
    }),
  icon: z.string().trim().optional(),
  url: z
    .string()
    .trim()
    .refine((val) => isSafeWhatsNewUrl(val), {
      message: "url must be a safe relative application path or https URL",
    })
    .optional(),
  minVersion: SemVerStringSchema.optional(),
  maxVersion: SemVerStringSchema.optional(),
});

export type WhatsNewItem = z.infer<typeof WhatsNewItemSchema>;

/**
 * Schema for the top-level remote feed
 */
export const WhatsNewFeedSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(z.unknown()),
});

export type WhatsNewFeed = {
  version: number;
  items: WhatsNewItem[];
};

/**
 * Schema for GET /api/admin/v1/whats-new response
 */
export const WhatsNewResponseSchema = z.object({
  item: WhatsNewItemSchema.nullable(),
  items: z.array(WhatsNewItemSchema),
  dismissedIds: z.array(z.string()),
  version: z.string(),
});

export type WhatsNewResponse = z.infer<typeof WhatsNewResponseSchema>;

/**
 * Schema for POST /api/admin/v1/whats-new/:id/dismiss response
 */
export const DismissWhatsNewResponseSchema = z.object({
  success: z.boolean(),
  dismissedIds: z.array(z.string()),
});

export type DismissWhatsNewResponse = z.infer<
  typeof DismissWhatsNewResponseSchema
>;
