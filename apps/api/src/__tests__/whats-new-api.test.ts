import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";
import { whatsNewService, usersService, rolesService } from "../services";
import { getDb, users } from "@vibress/database";
import { hashPassword } from "@vibress/security";
import { eq } from "drizzle-orm";
import * as security from "@vibress/security";

async function loginStaff(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/v1/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = (res.headers["set-cookie"] as unknown as string) || "";
  return setCookie.split(";")[0] ?? "";
}

async function ensureStaffUser(
  email: string,
  pass: string,
  roleKey: string = "admin",
): Promise<string> {
  const db = getDb();
  let user = await usersService.findByEmail(email);
  const passwordHash = await hashPassword(pass);
  if (!user) {
    user = await usersService.createUser({
      email,
      name: email.split("@")[0] || "Staff",
      passwordHash,
      status: "active",
    });
  } else {
    await db
      .update(users)
      .set({ passwordHash, status: "active" })
      .where(eq(users.id, user.id));
  }
  const role = await rolesService.findByKey(roleKey);
  if (role) {
    await rolesService.assignRoleToUser(user.id, role.id);
  }
  return user.id;
}

describe("What's New API & Service Subsystem", () => {
  let app: FastifyInstance;
  let ownerCookie: string;
  let editorCookie: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    whatsNewService.clearCache();
    vi.restoreAllMocks();
    const db = getDb();
    const { settings } = await import("@vibress/database");
    await db.delete(settings).where(eq(settings.namespace, "user_preferences"));

    await ensureStaffUser("owner@example.com", "OwnerPass123!", "owner");
    ownerCookie = await loginStaff(app, "owner@example.com", "OwnerPass123!");
    await ensureStaffUser("editor-wn@example.com", "EditorPass123!", "editor");
    editorCookie = await loginStaff(app, "editor-wn@example.com", "EditorPass123!");
  });

  describe("Authentication Guard", () => {
    it("rejects unauthenticated requests to GET /api/admin/v1/whats-new with 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects unauthenticated requests to POST /api/admin/v1/whats-new/:id/dismiss with 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/v1/whats-new/test-id/dismiss",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("Feed Fetching & In-Memory Caching (1 Hour TTL)", () => {
    it("successfully fetches, validates, and serves remote feed", async () => {
      const mockFeed = {
        version: 1,
        items: [
          {
            id: "feature-1",
            title: "Feature 1",
            description: "Description 1",
            publishedAt: "2026-09-01T00:00:00Z",
            minVersion: "1.0.0",
          },
        ],
      };

      const safeFetchSpy = vi
        .spyOn(security, "safeFetch")
        .mockResolvedValue({
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(mockFeed)),
          text: () => JSON.stringify(mockFeed),
          json: () => mockFeed,
          finalUrl: "https://example.com/whats-new.json",
        } as any);

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.item).toBeDefined();
      expect(json.item?.id).toBe("feature-1");
      expect(json.items).toHaveLength(1);
      expect(safeFetchSpy).toHaveBeenCalledTimes(1);

      // Second call should hit the 1-hour in-memory cache and not call safeFetch again
      const res2 = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().item?.id).toBe("feature-1");
      expect(safeFetchSpy).toHaveBeenCalledTimes(1); // Still 1 call
    });

    it("falls back to stale cache when remote fetch fails", async () => {
      // 1. Seed cache
      const cachedItems = [
        {
          id: "cached-item",
          title: "Cached Title",
          description: "Cached Description",
          publishedAt: "2026-09-01T00:00:00Z",
        },
      ];
      // Set timestamp 2 hours ago (expired cache)
      whatsNewService.setCache(cachedItems, Date.now() - 2 * 3600 * 1000);

      // 2. Mock network failure
      vi.spyOn(security, "safeFetch").mockRejectedValue(
        new Error("Network timeout / DNS resolution failed"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.item?.id).toBe("cached-item");
    });

    it("falls back to empty notification state gracefully when no cache exists and remote fails", async () => {
      whatsNewService.clearCache();
      vi.spyOn(security, "safeFetch").mockRejectedValue(
        new Error("GitHub 503 Service Unavailable"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.item).toBeNull();
      expect(json.items).toEqual([]);
    });

    it("tolerates individual malformed items in feed without dropping entire feed", async () => {
      const mixedFeed = {
        version: 1,
        items: [
          {
            id: "valid-feature",
            title: "Valid Feature",
            description: "Valid Desc",
            publishedAt: "2026-09-01T00:00:00Z",
          },
          {
            id: "", // Invalid: empty id
            title: "Broken",
            description: "Broken",
            publishedAt: "2026-09-01T00:00:00Z",
          },
          {
            id: "dangerous-url-item",
            title: "Dangerous",
            description: "Desc",
            publishedAt: "2026-09-01T00:00:00Z",
            url: "javascript:evil()", // Invalid url
          },
        ],
      };

      vi.spyOn(security, "safeFetch").mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify(mixedFeed)),
        text: () => JSON.stringify(mixedFeed),
        json: () => mixedFeed,
        finalUrl: "https://example.com/whats-new.json",
      } as any);

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.items).toHaveLength(1);
      expect(json.item?.id).toBe("valid-feature");
    });
  });

  describe("Per-User Dismissal & Authorization Isolation", () => {
    it("dismisses an item for the authenticated user and persists across calls", async () => {
      const feed = {
        version: 1,
        items: [
          {
            id: "dismiss-test-item",
            title: "Dismiss Test",
            description: "Testing dismissal",
            publishedAt: "2026-09-01T00:00:00Z",
          },
        ],
      };

      vi.spyOn(security, "safeFetch").mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify(feed)),
        text: () => JSON.stringify(feed),
        json: () => feed,
        finalUrl: "https://example.com/whats-new.json",
      } as any);

      // 1. Initial GET shows item
      const res1 = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });
      expect(res1.json().item?.id).toBe("dismiss-test-item");

      // 2. Dismiss item
      const dismissRes = await app.inject({
        method: "POST",
        url: "/api/admin/v1/whats-new/dismiss-test-item/dismiss",
        headers: { cookie: ownerCookie },
      });
      expect(dismissRes.statusCode).toBe(200);
      expect(dismissRes.json().success).toBe(true);
      expect(dismissRes.json().dismissedIds).toContain("dismiss-test-item");

      // 3. Subsequent GET returns null item for owner
      const res2 = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });
      expect(res2.json().item).toBeNull();
      expect(res2.json().dismissedIds).toContain("dismiss-test-item");

      // 4. Calling dismiss again is idempotent (no duplicates)
      const dismissRes2 = await app.inject({
        method: "POST",
        url: "/api/admin/v1/whats-new/dismiss-test-item/dismiss",
        headers: { cookie: ownerCookie },
      });
      expect(dismissRes2.statusCode).toBe(200);
      const occurrences = dismissRes2
        .json()
        .dismissedIds.filter((id: string) => id === "dismiss-test-item");
      expect(occurrences).toHaveLength(1);
    });

    it("guarantees User A dismissal does not affect User B", async () => {
      const feed = {
        version: 1,
        items: [
          {
            id: "cross-user-item",
            title: "Cross User",
            description: "Testing cross user isolation",
            publishedAt: "2026-09-01T00:00:00Z",
          },
        ],
      };

      vi.spyOn(security, "safeFetch").mockResolvedValue({
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify(feed)),
        text: () => JSON.stringify(feed),
        json: () => feed,
        finalUrl: "https://example.com/whats-new.json",
      } as any);

      // Owner dismisses cross-user-item
      await app.inject({
        method: "POST",
        url: "/api/admin/v1/whats-new/cross-user-item/dismiss",
        headers: { cookie: ownerCookie },
      });

      // Owner sees null
      const ownerRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });
      expect(ownerRes.json().item).toBeNull();

      // Editor STILL sees cross-user-item!
      const editorRes = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: editorCookie },
      });
      expect(editorRes.json().item?.id).toBe("cross-user-item");
    });

    it("displays a newly added notification item even if previous notification was dismissed", async () => {
      // 1. Initial feed with item-A
      const feed1 = {
        version: 1,
        items: [
          {
            id: "old-item",
            title: "Old Item",
            description: "Old",
            publishedAt: "2026-09-01T00:00:00Z",
          },
        ],
      };

      whatsNewService.setCache(feed1.items);

      // Dismiss old-item
      await app.inject({
        method: "POST",
        url: "/api/admin/v1/whats-new/old-item/dismiss",
        headers: { cookie: ownerCookie },
      });

      // 2. Feed updates with a brand new item (new-item)
      const feed2 = {
        version: 1,
        items: [
          {
            id: "old-item",
            title: "Old Item",
            description: "Old",
            publishedAt: "2026-09-01T00:00:00Z",
          },
          {
            id: "new-item",
            title: "Brand New Feature",
            description: "New",
            publishedAt: "2026-09-10T00:00:00Z",
          },
        ],
      };
      whatsNewService.setCache(feed2.items);

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/whats-new",
        headers: { cookie: ownerCookie },
      });

      expect(res.json().item?.id).toBe("new-item");
    });
  });
});
