import { z } from 'zod';

export const MemberAuthRequestSchema = z.object({
  email: z.string().trim().min(3).max(254),
});
export type MemberAuthRequestInput = z.infer<typeof MemberAuthRequestSchema>;

export const MemberAuthVerifyQuerySchema = z.object({
  token: z.string().min(1),
});

export const MemberSelfSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
});
export type MemberSelfDto = z.infer<typeof MemberSelfSchema>;

export const MemberProfileUpdateSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
});
export type MemberProfileUpdateInput = z.infer<typeof MemberProfileUpdateSchema> & { name?: string | null };

export const AdminMemberSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(['active', 'disabled']),
  emailVerified: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type AdminMemberSummaryDto = z.infer<typeof AdminMemberSummarySchema>;

export const AdminMemberDetailSchema = AdminMemberSummarySchema.extend({
  emailNormalized: z.string(),
  disabledAt: z.string().nullable(),
  updatedAt: z.string(),
  activeSessionCount: z.number().optional(),
});
export type AdminMemberDetailDto = z.infer<typeof AdminMemberDetailSchema>;
