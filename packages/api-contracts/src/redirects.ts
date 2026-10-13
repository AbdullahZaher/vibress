import { z } from "zod";

export const CreateRedirectInputSchema = z.object({
  source: z.string().min(1).max(500),
  destination: z.string().min(1).max(2000),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
  enabled: z.boolean().optional(),
});

export const UpdateRedirectInputSchema = CreateRedirectInputSchema.partial().extend({
  sortOrder: z.number().int().optional(),
});

export const PublicRedirectResolveQuerySchema = z.object({
  path: z.string().min(1).max(500).startsWith("/").refine((s) => !s.startsWith("//")),
});
