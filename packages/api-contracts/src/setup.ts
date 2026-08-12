import { z } from 'zod';

/**
 * First-run setup contracts. The bootstrap secret (VIBRESS_SETUP_TOKEN) is
 * never part of any body — it travels exclusively in the
 * X-Vibress-Setup-Token request header.
 */

export const SetupStatusResponseSchema = z.object({
  installed: z.boolean(),
});
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;

export const SetupPreflightResponseSchema = z.object({
  ready: z.boolean(),
  database: z.boolean(),
  redis: z.boolean(),
  configuration: z.boolean(),
});
export type SetupPreflightResponse = z.infer<typeof SetupPreflightResponseSchema>;

const SiteNameSchema = z.string().trim().min(1, 'Site name is required').max(120);
const SiteDescriptionSchema = z.string().trim().max(500).default('');
const SiteTaglineSchema = z.string().trim().max(200).optional();
const LocaleSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/, 'Invalid locale')
  .default('en');

export const SetupSiteInputSchema = z.object({
  name: SiteNameSchema,
  description: SiteDescriptionSchema,
  tagline: SiteTaglineSchema,
  locale: LocaleSchema,
});
export type SetupSiteInput = z.infer<typeof SetupSiteInputSchema>;

export const SetupOwnerInputSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.string().trim().email('Invalid email').max(255),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
});
export type SetupOwnerInput = z.infer<typeof SetupOwnerInputSchema>;

export const SetupCompleteRequestSchema = z.object({
  site: SetupSiteInputSchema,
  owner: SetupOwnerInputSchema,
});
export type SetupCompleteRequest = z.infer<typeof SetupCompleteRequestSchema>;

export const SetupCompleteResponseSchema = z.object({
  installed: z.boolean(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      slug: z.string().nullable().optional(),
      roles: z.array(z.string()),
      permissions: z.array(z.string()),
    })
    .nullable()
    .optional(),
});
export type SetupCompleteResponse = z.infer<typeof SetupCompleteResponseSchema>;

/** Header carrying the bootstrap setup secret (never in a JSON body). */
export const SETUP_TOKEN_HEADER = 'x-vibress-setup-token';
