import { z } from "zod";

export const SocialPlatformSchema = z.enum([
  "instagram", "x", "facebook", "youtube", "tiktok", "linkedin",
  "github", "threads", "mastodon", "bluesky", "telegram", "whatsapp",
  "pinterest", "reddit", "discord", "rss", "custom",
]);

export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

const SocialLinkFields = z.object({
  id: z.string().trim().min(1).max(80),
  platform: SocialPlatformSchema,
  label: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2048).refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" &&
        Boolean(parsed.hostname) &&
        !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "Social link must be an HTTPS URL without embedded credentials"),
});

export const SocialLinksSchema = z.array(SocialLinkFields.strict()).max(20).superRefine((items, ctx) => {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (ids.has(item.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Duplicate social link ID" });
    }
    ids.add(item.id);
  });
});
export type SocialLink = z.infer<typeof SocialLinkFields>;
export type PublicSocialLink = SocialLink & { iconUrl: string };

/** Read-time fail-closed boundary for older or malformed persisted values. */
export function toPublicSocialLinks(input: unknown): PublicSocialLink[] {
  const parsed = z.array(SocialLinkFields).max(20).safeParse(input);
  if (!parsed.success) return [];
  const ids = new Set<string>();
  const result: PublicSocialLink[] = [];
  for (const link of parsed.data) {
    if (ids.has(link.id)) return [];
    ids.add(link.id);
    result.push({ ...link, iconUrl: `/social-icons/${link.platform}.svg` });
  }
  return result;
}
