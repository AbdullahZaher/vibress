import { z } from "zod";

export const MediaAssetSchema = z.object({
  id: z.string(),
  storageProvider: z.string(),
  storageKey: z.string(),
  originalFilename: z.string(),
  displayName: z.string(),
  mimeType: z.string(),
  extension: z.string(),
  sizeBytes: z.number(),
  checksum: z.string(),
  assetType: z.enum(["image", "video", "audio", "file"]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  uploadedBy: z.string().nullable().optional(),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MediaAssetDto = z.infer<typeof MediaAssetSchema>;

export const UpdateMediaInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(255)
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateMediaInputDto = z.infer<typeof UpdateMediaInputSchema>;

export const ListMediaFilterSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  assetType: z.enum(["image", "video", "audio", "file"]).optional(),
  mimeType: z.string().optional(),
  uploadedBy: z.string().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(["createdAt", "updatedAt", "displayName", "sizeBytes"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});
export type ListMediaFilterDto = z.infer<typeof ListMediaFilterSchema>;

export const MediaReferenceSummarySchema = z.object({
  mediaId: z.string(),
  totalReferences: z.number(),
  references: z.array(
    z.object({
      resourceType: z.string(),
      resourceId: z.string(),
      fieldPath: z.string(),
    }),
  ),
});
export type MediaReferenceSummaryDto = z.infer<
  typeof MediaReferenceSummarySchema
>;
