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

export interface PublicCommentDTO {
  id: string;
  postId: string;
  parentId: string | null;
  author: {
    id: string;
    name: string;
    avatarUrl?: string | null | undefined;
  };
  body: string | null;
  status: "published" | "pending_review";
  likeCount: number;
  hasLiked: boolean;
  isDeleted: boolean;
  replyCount: number;
  depth: number;
  createdAt: string;
  replies?: PublicCommentDTO[] | undefined;
}

export const AdminCommentFilterSchema = z.object({
  postId: z.string().optional(),
  status: z.enum(["published", "pending_review", "hidden", "deleted", "rejected"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["newest", "oldest", "top"]).optional(),
});
export type AdminCommentFilterInput = z.infer<typeof AdminCommentFilterSchema>;

export const ModerateCommentSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ModerateCommentInput = z.infer<typeof ModerateCommentSchema>;

export const ResolveReportSchema = z.object({
  notes: z.string().max(1000).optional(),
});
export type ResolveReportInput = z.infer<typeof ResolveReportSchema>;
