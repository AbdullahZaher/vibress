import { safeFetch } from "@vibress/security";
import { appLogger } from "./observability";
import { getConfig } from "@vibress/config";
import {
  WhatsNewFeedSchema,
  WhatsNewItem,
} from "@vibress/api-contracts";
import {
  sanitizeWhatsNewItems,
  selectWhatsNewItem,
} from "@vibress/utils";
import { SettingRepository } from "@vibress/settings";

export const DEFAULT_WHATS_NEW_FEED_URL =
  "https://raw.githubusercontent.com/AbdullahZaher/vibress/main/.github/whats-new.json";

export const WHATS_NEW_CACHE_TTL_MS = 60 * 60 * 1000; // 3600 seconds (1 hour)

export interface CachedFeed {
  items: WhatsNewItem[];
  fetchedAt: number;
}

export class WhatsNewService {
  private memoryCache: CachedFeed | null = null;
  private feedUrl: string;

  constructor(
    private settingRepo: SettingRepository,
    feedUrl?: string,
  ) {
    this.feedUrl =
      feedUrl ||
      process.env.WHATS_NEW_FEED_URL ||
      DEFAULT_WHATS_NEW_FEED_URL;
  }

  public setFeedUrl(url: string): void {
    this.feedUrl = url;
    this.memoryCache = null; // Invalidate cache when URL changes
  }

  public getFeedUrl(): string {
    return this.feedUrl;
  }

  public clearCache(): void {
    this.memoryCache = null;
  }

  public setCache(items: WhatsNewItem[], fetchedAt: number = Date.now()): void {
    this.memoryCache = { items, fetchedAt };
  }

  public getCachedData(): CachedFeed | null {
    return this.memoryCache;
  }

  /**
   * Fetches remote What's New feed with:
   * 1. 1-hour cache hit return
   * 2. SSRF-safe fetch with 5s timeout
   * 3. Schema validation with individual item fault-tolerance
   * 4. Stale cache fallback if fetch/parse fails
   * 5. Graceful empty items fallback if no cache available
   */
  public async getFeed(forceFresh = false): Promise<WhatsNewItem[]> {
    const now = Date.now();

    // 1. In-memory cache hit (< 1 hour)
    if (
      !forceFresh &&
      this.memoryCache &&
      now - this.memoryCache.fetchedAt < WHATS_NEW_CACHE_TTL_MS
    ) {
      return this.memoryCache.items;
    }

    // 2. Fetch remote
    try {
      const response = await safeFetch(this.feedUrl, {
        method: "GET",
        timeout: 5000,
        headers: {
          "User-Agent": "Vibress-Admin-WhatsNew/1.0",
          Accept: "application/json",
        },
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} from remote feed endpoint`);
      }

      const text =
        typeof (response as unknown as { text?: () => string }).text === "function"
          ? (response as unknown as { text: () => string }).text()
          : response.body.toString("utf-8");
      let rawJson: unknown;
      try {
        rawJson = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(
          `Malformed JSON in remote feed: ${(parseErr as Error).message}`,
          { cause: parseErr },
        );
      }

      const topLevelParse = WhatsNewFeedSchema.safeParse(rawJson);
      if (!topLevelParse.success) {
        throw new Error(`Invalid feed schema: ${topLevelParse.error.message}`);
      }

      // Individual item sanitization: keep valid items, discard malformed ones
      const validItems = sanitizeWhatsNewItems(topLevelParse.data.items);

      // Store in memory cache
      this.memoryCache = {
        items: validItems,
        fetchedAt: now,
      };

      return validItems;
    } catch (err) {
      appLogger.warn(
        "whats_new.fetch_failed",
        {
          feedUrl: this.feedUrl,
          error: (err as Error).message,
          hasStaleCache: Boolean(this.memoryCache),
        },
      );

      // Stale cache fallback
      if (this.memoryCache && this.memoryCache.items.length > 0) {
        appLogger.info("whats_new.cache_fallback", {
          cachedItemsCount: this.memoryCache.items.length,
        });
        return this.memoryCache.items;
      }

      // No cache fallback: return empty list without failing the caller
      return [];
    }
  }

  /**
   * Retrieves the permanently dismissed notification IDs for an authenticated user.
   */
  public async getUserDismissedIds(userId: string): Promise<string[]> {
    if (!userId || typeof userId !== "string") {
      return [];
    }

    try {
      const record = await this.settingRepo.get(
        "user_preferences",
        `dismissed_whats_new:${userId}`,
      );

      if (!record || !record.value) {
        return [];
      }

      if (Array.isArray(record.value)) {
        return record.value.filter((id): id is string => typeof id === "string");
      }

      if (
        typeof record.value === "object" &&
        record.value !== null &&
        "dismissedWhatsNew" in record.value &&
        Array.isArray(
          (record.value as { dismissedWhatsNew: unknown[] }).dismissedWhatsNew,
        )
      ) {
        return (
          record.value as { dismissedWhatsNew: unknown[] }
        ).dismissedWhatsNew.filter((id): id is string => typeof id === "string");
      }

      return [];
    } catch (err) {
      appLogger.error(
        "whats_new.get_dismissed_failed",
        { userId },
        err as Error,
      );
      return [];
    }
  }

  /**
   * Idempotently dismisses a notification ID for a specific user in the database.
   */
  public async dismissForUser(
    userId: string,
    notificationId: string,
  ): Promise<string[]> {
    if (!userId || !notificationId || typeof notificationId !== "string") {
      return [];
    }

    const cleanId = notificationId.trim();
    if (!cleanId) {
      return this.getUserDismissedIds(userId);
    }

    try {
      const current = await this.getUserDismissedIds(userId);
      if (!current.includes(cleanId)) {
        const updated = [...current, cleanId];
        await this.settingRepo.set({
          namespace: "user_preferences",
          key: `dismissed_whats_new:${userId}`,
          value: updated,
          valueType: "json",
          classification: "staff-visible",
          updatedBy: userId,
        });
        return updated;
      }
      return current;
    } catch (err) {
      appLogger.error(
        "whats_new.dismiss_failed",
        { userId, notificationId: cleanId },
        err as Error,
      );
      throw err;
    }
  }

  /**
   * Resolves the single highest-priority eligible item for the authenticated user.
   */
  public async getEligibleItemForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    item: WhatsNewItem | null;
    items: WhatsNewItem[];
    dismissedIds: string[];
    version: string;
  }> {
    const config = getConfig();
    const currentVersion = config.system.version;

    const [items, dismissedIds] = await Promise.all([
      this.getFeed(),
      this.getUserDismissedIds(userId),
    ]);

    const item = selectWhatsNewItem({
      items,
      currentVersion,
      now,
      dismissedIds,
    });

    return {
      item,
      items,
      dismissedIds,
      version: currentVersion,
    };
  }
}
