import { satisfiesSemver } from "./semver";

export interface WhatsNewItem {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  icon?: string | undefined;
  url?: string | undefined;
  minVersion?: string | undefined;
  maxVersion?: string | undefined;
}

const SEMVER_REGEX =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidWhatsNewUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("ftp:")
  ) {
    return false;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates and filters an array of raw items, dropping individual malformed items
 * without failing the entire collection.
 */
export function sanitizeWhatsNewItems(rawItems: unknown[]): WhatsNewItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const validItems: WhatsNewItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;

    if (
      typeof obj.id !== "string" ||
      !obj.id.trim() ||
      typeof obj.title !== "string" ||
      !obj.title.trim() ||
      typeof obj.description !== "string" ||
      !obj.description.trim() ||
      typeof obj.publishedAt !== "string" ||
      !obj.publishedAt.trim()
    ) {
      continue;
    }

    const pubTime = Date.parse(obj.publishedAt);
    if (isNaN(pubTime)) {
      continue;
    }

    if (obj.url !== undefined) {
      if (typeof obj.url !== "string" || !isValidWhatsNewUrl(obj.url)) {
        continue;
      }
    }

    if (obj.minVersion !== undefined) {
      if (
        typeof obj.minVersion !== "string" ||
        !SEMVER_REGEX.test(obj.minVersion.trim())
      ) {
        continue;
      }
    }

    if (obj.maxVersion !== undefined) {
      if (
        typeof obj.maxVersion !== "string" ||
        !SEMVER_REGEX.test(obj.maxVersion.trim())
      ) {
        continue;
      }
    }

    const item: WhatsNewItem = {
      id: obj.id.trim(),
      title: obj.title.trim(),
      description: obj.description.trim(),
      publishedAt: obj.publishedAt.trim(),
      icon: typeof obj.icon === "string" && obj.icon.trim() ? obj.icon.trim() : undefined,
      url: typeof obj.url === "string" && obj.url.trim() ? obj.url.trim() : undefined,
      minVersion:
        typeof obj.minVersion === "string" && obj.minVersion.trim()
          ? obj.minVersion.trim()
          : undefined,
      maxVersion:
        typeof obj.maxVersion === "string" && obj.maxVersion.trim()
          ? obj.maxVersion.trim()
          : undefined,
    };

    validItems.push(item);
  }
  return validItems;
}

export interface SelectWhatsNewOptions {
  items: WhatsNewItem[];
  currentVersion: string;
  now?: Date;
  dismissedIds?: string[];
}

/**
 * Core deterministic single-item selection algorithm:
 * 1. Filters out future items (publishedAt > now)
 * 2. Filters out version-incompatible items (minVersion / maxVersion bounds)
 * 3. Filters out dismissed notification IDs
 * 4. Sorts remaining eligible items by publishedAt DESC, then id ASC (deterministic tie-breaker)
 * 5. Returns the single highest priority eligible item, or null if none eligible.
 */
export function selectWhatsNewItem(
  options: SelectWhatsNewOptions,
): WhatsNewItem | null {
  const {
    items,
    currentVersion,
    now = new Date(),
    dismissedIds = [],
  } = options;

  const nowMs = now.getTime();
  const dismissedSet = new Set(dismissedIds);

  const eligible = items.filter((item) => {
    // 1. Dismissed check
    if (dismissedSet.has(item.id)) {
      return false;
    }

    // 2. Publication date check
    const pubTime = new Date(item.publishedAt).getTime();
    if (isNaN(pubTime) || pubTime > nowMs) {
      return false;
    }

    // 3. Version bounds check
    if (!satisfiesSemver(currentVersion, item.minVersion, item.maxVersion)) {
      return false;
    }

    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  // Sort: publishedAt DESC, id ASC tie-breaker
  eligible.sort((a, b) => {
    const timeA = new Date(a.publishedAt).getTime();
    const timeB = new Date(b.publishedAt).getTime();

    if (timeA !== timeB) {
      return timeB - timeA; // DESC (newest first)
    }

    return a.id.localeCompare(b.id); // ASC tie breaker
  });

  return eligible[0] ?? null;
}
