import crypto from "node:crypto";

/**
 * Privacy-safe traffic helpers. Pure functions so they are unit-testable and
 * shared by the collector and the query service.
 */

/** Strip the query string and trailing slash; keep a clean pathname. */
export function normalizePath(rawPath: string): string {
  if (typeof rawPath !== "string") return "/";
  let p = rawPath.split("?")[0] ?? "/";
  p = p.split("#")[0] ?? p;
  if (!p.startsWith("/")) p = `/${p}`;
  // Collapse duplicate slashes and trailing slash (keep root as "/")
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.length > 512) p = p.slice(0, 512);
  return p;
}

const WWW_RE = /^www\./;
const TRACKING_DOMAINS = new Set(["localhost", "127.0.0.1"]);

/**
 * Sentinel stored for same-site referrers. It is never surfaced as a source
 * row and never counted as Direct — internal navigation must not inflate
 * acquisition metrics.
 */
export const INTERNAL_REFERRER = "internal";

/**
 * Normalize a referrer URL:
 *   - missing/empty referrer  → null (Direct acquisition)
 *   - external referrer       → bare domain (query strings/paths stripped)
 *   - same-site referrer      → 'internal' sentinel (ignored by queries)
 * Never retains full URLs, query strings, or fragments.
 */
export function normalizeReferrerDomain(
  referrer: string | null | undefined,
  currentOrigin?: string | null,
): string | null | typeof INTERNAL_REFERRER {
  if (!referrer || typeof referrer !== "string") return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (!host) return null;
  const lower = host.toLowerCase();
  if (TRACKING_DOMAINS.has(lower)) return INTERNAL_REFERRER;
  // Same-site navigation is internal — never an acquisition source.
  if (currentOrigin) {
    try {
      if (new URL(currentOrigin).hostname.toLowerCase() === lower)
        return INTERNAL_REFERRER;
    } catch {
      // ignore malformed origin
    }
  }
  return lower.replace(WWW_RE, "");
}

/** Keyed HMAC-SHA256 of the anonymous browser id — raw ids are never stored. */
export function deriveVisitorHash(visitorId: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`vibress-analytics:${visitorId}`)
    .digest("hex");
}

/** Simple practical bot classification from the User-Agent (no heavy subsystem). */
const BOT_PATTERNS = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /slurp/i,
  /bingpreview/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /pinterest/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /preview/i,
  /headless/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /uptime/i,
  /monitor/i,
  /pingdom/i,
  /statuscake/i,
  /newrelic/i,
  /datadog/i,
  /ahrefs/i,
  /semrush/i,
  /mj12bot/i,
  /dotbot/i,
  /baiduspider/i,
  /yandex/i,
  /duckduckbot/i,
];

export function classifyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || typeof userAgent !== "string") return true; // absent UA → treat as non-human
  return BOT_PATTERNS.some((re) => re.test(userAgent));
}

export type AnalyticsRange = "7d" | "30d" | "90d";

export interface ResolvedRange {
  range: AnalyticsRange;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

/**
 * Resolve a UI date range into the current period and the immediately
 * preceding period of the same length (UTC).
 *
 * Supported ranges are 7d / 30d / 90d only. YTD is intentionally not
 * supported: unique visitors are computed from retained raw events
 * (90-day retention), so a year-to-date window could never be accurate and
 * its previous-year comparison would be impossible.
 */
export function resolveDateRange(
  range: string | undefined,
  now: Date = new Date(),
): ResolvedRange {
  const r = (range || "30d").toLowerCase() as AnalyticsRange;
  const dayMs = 24 * 3600 * 1000;

  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const startOfToday = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );

  switch (r) {
    case "7d": {
      const from = new Date(startOfToday.getTime() - 6 * dayMs);
      const previousTo = new Date(from.getTime() - dayMs);
      const previousFrom = new Date(previousTo.getTime() - 6 * dayMs);
      return { range: "7d", from, to: end, previousFrom, previousTo };
    }
    case "90d": {
      const from = new Date(startOfToday.getTime() - 89 * dayMs);
      const previousTo = new Date(from.getTime() - dayMs);
      const previousFrom = new Date(previousTo.getTime() - 89 * dayMs);
      return { range: "90d", from, to: end, previousFrom, previousTo };
    }
    case "30d":
    default: {
      const from = new Date(startOfToday.getTime() - 29 * dayMs);
      const previousTo = new Date(from.getTime() - dayMs);
      const previousFrom = new Date(previousTo.getTime() - 29 * dayMs);
      return { range: "30d", from, to: end, previousFrom, previousTo };
    }
  }
}

export interface PercentageChange {
  current: number;
  previous: number;
  /** null when previous is 0 (avoids Infinity); 0 when both are 0. */
  percentage: number | null;
  isNew: boolean;
}

/**
 * Percentage change between two periods. previous = 0 and current > 0 → null
 * with isNew=true (UI shows "New"); both zero → 0. Never Infinity/NaN.
 */
export function computePercentageChange(
  current: number,
  previous: number,
): PercentageChange {
  if (previous === 0) {
    if (current === 0)
      return { current, previous, percentage: 0, isNew: false };
    return { current, previous, percentage: null, isNew: true };
  }
  const pct = ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    percentage: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null,
    isNew: false,
  };
}

/** UTC day bucket (YYYY-MM-DD) for a date. */
export function toUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
