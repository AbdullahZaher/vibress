import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.string().optional(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const LoginResponseSchema = z.object({
  user: UserSummarySchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const LogoutResponseSchema = z.object({
  success: z.boolean(),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const MeResponseSchema = z.object({
  user: UserSummarySchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const RoleSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean(),
});
export type RoleSummary = z.infer<typeof RoleSummarySchema>;

export const PermissionSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string().nullable().optional(),
});
export type PermissionSummary = z.infer<typeof PermissionSummarySchema>;

export const ErrorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorResponseSchema = z.object({
  errors: z.array(ErrorDetailSchema),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
