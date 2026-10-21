import { createHash, randomBytes } from "node:crypto";
import { getRedisClient, buildSystemCacheKey } from "@vibress/cache";
import { z } from "zod";

/** Internal transport only. Tokens are single-use and never serialized into plugin HTML. */
const FrameTicketSchema = z.object({
  staffId: z.string().min(1).max(200),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
  publicationId: z.string().min(1).max(200),
  pluginId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  viewId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Server-issued proof is embedded only into this verified HTML response.
  bridgeNonce: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type AdminUiFrameClaim = z.infer<typeof FrameTicketSchema>;
const TTL_SECONDS = 45;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function sessionFingerprint(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

/** GETDEL is atomic across API replicas; Redis outage must fail closed. */
export class AdminUiFrameTickets {
  async issue(input: AdminUiFrameClaim): Promise<string> {
    const claim = FrameTicketSchema.parse(input);
    const token = randomBytes(32).toString("hex");
    const key = buildSystemCacheKey("extension-admin-frame", sessionFingerprint(token));
    const saved = await getRedisClient().set(key, JSON.stringify(claim), "EX", TTL_SECONDS, "NX");
    if (saved !== "OK") throw new Error("Admin frame ticket could not be issued");
    return token;
  }

  async consume(token: string): Promise<AdminUiFrameClaim | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const key = buildSystemCacheKey("extension-admin-frame", sessionFingerprint(token));
    const value: unknown = await getRedisClient().call("GETDEL", key);
    if (typeof value !== "string") return null;
    const parsed = FrameTicketSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  }
}

export const adminUiFrameTickets = new AdminUiFrameTickets();
