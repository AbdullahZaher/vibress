import { z } from "zod";

export const CreateCommentSchema = z.object({
  postId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  body: z.string().min(1).max(5000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;

export const ReportCommentSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type ReportCommentInput = z.infer<typeof ReportCommentSchema>;

export const CreateRecommendationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateRecommendationInput = z.infer<
  typeof CreateRecommendationSchema
>;

export const UpdateRecommendationSchema =
  CreateRecommendationSchema.partial().omit({ url: true });
export type UpdateRecommendationInput = z.infer<
  typeof UpdateRecommendationSchema
>;

export const RecommendationClickSchema = z.object({
  sessionId: z.string().nullable().optional(),
});
export type RecommendationClickInput = z.infer<
  typeof RecommendationClickSchema
>;
