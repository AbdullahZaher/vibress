import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const Payload = z.object({
  v: z.literal(1),
  pluginId: z.string().min(1).max(100),
  publicationId: z.string().min(1).max(200),
  actorId: z.string().min(1).max(200),
  resourceId: z.string().min(1).max(64),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  filterHash: z.string().regex(/^[a-f0-9]{64}$/),
  lastId: Id,
  expiresAt: z.number().int().positive(),
}).strict();
export type NativeCursorContext = Omit<z.infer<typeof Payload>, "v" | "lastId" | "expiresAt">;
const CURSOR_TTL_MS = 15 * 60 * 1000;

export function nativeFilterHash(field?: string, value?: string): string {
  return createHash("sha256").update(JSON.stringify([field ?? null, value ?? null])).digest("hex");
}
function keyBytes(secret: string | null): Buffer | null {
  return secret && /^[a-f0-9]{64}$/.test(secret) ? Buffer.from(secret, "hex") : null;
}
export function issueNativeCursor(
  context: NativeCursorContext, lastId: string, secret: string | null, now = Date.now(),
): string | null {
  const key = keyBytes(secret);
  if (!key) return null;
  const parsed = Payload.safeParse({ v: 1, ...context, lastId, expiresAt: now + CURSOR_TTL_MS });
  if (!parsed.success) return null;
  const body = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  const token = body + "." + mac;
  return token.length <= 1024 ? token : null;
}
export function readNativeCursor(
  token: string, context: NativeCursorContext, secret: string | null, now = Date.now(),
): string | null {
  const key = keyBytes(secret);
  if (!key || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  let provided: Buffer;
  try { provided = Buffer.from(mac, "base64url"); } catch { return null; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const parsed = Payload.safeParse(decoded);
    if (!parsed.success || parsed.data.expiresAt <= now) return null;
    return parsed.data.pluginId === context.pluginId &&
      parsed.data.publicationId === context.publicationId &&
      parsed.data.actorId === context.actorId &&
      parsed.data.resourceId === context.resourceId &&
      parsed.data.digest === context.digest &&
      parsed.data.filterHash === context.filterHash
      ? parsed.data.lastId : null;
  } catch { return null; }
}
