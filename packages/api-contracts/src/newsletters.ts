import { z } from "zod";

export const AdminNewsletterInputSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  senderName: z.string().min(1).max(200),
  senderEmail: z.string().email(),
  replyTo: z.string().email().nullable().optional(),
});
export type AdminNewsletterInput = z.infer<typeof AdminNewsletterInputSchema>;

export const AdminNewsletterSendInputSchema = z.object({
  newsletterId: z.string().min(1),
  subject: z.string().min(1).max(200),
  content: z.unknown(),
  audience: z.object({
    filter: z.enum(["all", "paid", "free"]).default("all"),
    productId: z.string().nullable().optional(),
    planId: z.string().nullable().optional(),
  }),
  scheduledAt: z.string().datetime().nullable().optional(),
  sendNow: z.boolean().default(false),
});
export type AdminNewsletterSendInput = z.infer<
  typeof AdminNewsletterSendInputSchema
>;

export const AdminTestEmailInputSchema = z.object({
  newsletterId: z.string().min(1),
  subject: z.string().min(1).max(200),
  content: z.unknown(),
  recipients: z.array(z.string().email()).min(1).max(10),
});
export type AdminTestEmailInput = z.infer<typeof AdminTestEmailInputSchema>;

export const MemberPreferencesUpdateSchema = z.object({
  newsletterId: z.string().min(1),
  subscribed: z.boolean(),
});
export type MemberPreferencesUpdateInput = z.infer<
  typeof MemberPreferencesUpdateSchema
>;
