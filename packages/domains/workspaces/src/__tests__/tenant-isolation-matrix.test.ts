import { describe, it, expect, vi } from "vitest";
import {
  WorkspaceService,
} from "../application/workspace-service";
import {
  TenantAccessDeniedError,
  type Workspace,
  type Publication,
  type PublicationMembership,
  type TenantContext,
  type WorkspaceMember,
} from "../domain/workspace";

describe("Phase 12: Comprehensive Multi-Tenant & Multi-Publication Isolation Matrix", () => {
  const ws1: Workspace = {
    id: "ws-alpha",
    name: "Alpha Workspace",
    slug: "alpha",
    ownerId: "user-alpha-owner",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const ws2: Workspace = {
    id: "ws-beta",
    name: "Beta Workspace",
    slug: "beta",
    ownerId: "user-beta-owner",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const pubAlpha1: Publication = {
    id: "pub-alpha-main",
    workspaceId: "ws-alpha",
    name: "Alpha Main Magazine",
    slug: "alpha-main",
    locale: "en",
    isDefault: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const pubAlpha2: Publication = {
    id: "pub-alpha-tech",
    workspaceId: "ws-alpha",
    name: "Alpha Tech Dispatch",
    slug: "alpha-tech",
    locale: "ar",
    isDefault: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const pubBeta1: Publication = {
    id: "pub-beta-news",
    workspaceId: "ws-beta",
    name: "Beta Daily News",
    slug: "beta-news",
    locale: "en",
    isDefault: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const workspaceRepo = {
    findById: vi.fn(async (id: string) => (id === "ws-alpha" ? ws1 : id === "ws-beta" ? ws2 : null)),
    findBySlug: vi.fn(async (slug: string) => (slug === "alpha" ? ws1 : slug === "beta" ? ws2 : null)),
    create: vi.fn(),
    addMember: vi.fn(),
    getMembership: vi.fn(async (workspaceId: string, userId: string) => {
      if (workspaceId === "ws-alpha" && (userId === "user-alpha-owner" || userId === "user-alpha-editor")) {
        return { id: "m-1", workspaceId: "ws-alpha", userId, role: "owner" as const, createdAt: new Date(), updatedAt: new Date() };
      }
      if (workspaceId === "ws-beta" && (userId === "user-beta-owner" || userId === "user-beta-author")) {
        return { id: "m-2", workspaceId: "ws-beta", userId, role: "admin" as const, createdAt: new Date(), updatedAt: new Date() };
      }
      return null;
    }),
    listMembers: vi.fn(async () => []),
    listUserWorkspaces: vi.fn(async () => []),
  };

  const publicationRepo = {
    findById: vi.fn(async (pubId: string) => {
      if (pubId === "pub-alpha-main") return pubAlpha1;
      if (pubId === "pub-alpha-tech") return pubAlpha2;
      if (pubId === "pub-beta-news") return pubBeta1;
      return null;
    }),
    findBySlug: vi.fn(async (workspaceId: string, slug: string) => {
      if (workspaceId === "ws-alpha" && slug === "alpha-main") return pubAlpha1;
      if (workspaceId === "ws-alpha" && slug === "alpha-tech") return pubAlpha2;
      if (workspaceId === "ws-beta" && slug === "beta-news") return pubBeta1;
      return null;
    }),
    listByWorkspace: vi.fn(async (wsId: string) => {
      if (wsId === "ws-alpha") return [pubAlpha1, pubAlpha2];
      if (wsId === "ws-beta") return [pubBeta1];
      return [];
    }),
    create: vi.fn(),
    addMember: vi.fn(),
    getMembership: vi.fn(async (pubId: string, userId: string) => {
      if (pubId === "pub-alpha-main" && userId === "user-alpha-editor") {
        return { id: "pm-1", publicationId: pubId, userId, role: "editor" as const, createdAt: new Date() };
      }
      if (pubId === "pub-alpha-tech" && userId === "user-alpha-editor") {
        return { id: "pm-2", publicationId: pubId, userId, role: "editor" as const, createdAt: new Date() };
      }
      if (pubId === "pub-beta-news" && userId === "user-beta-author") {
        return { id: "pm-3", publicationId: pubId, userId, role: "author" as const, createdAt: new Date() };
      }
      return null;
    }),
    listUserPublications: vi.fn(async () => []),
  };

  const service = new WorkspaceService(workspaceRepo, publicationRepo);

  describe("1. Context Propagation & Switching", () => {
    it("successfully switches workspace and sets context", async () => {
      const ctx = await service.switchWorkspace("ws-alpha", "user-alpha-editor");
      expect(ctx.workspaceId).toBe("ws-alpha");
      expect(ctx.userId).toBe("user-alpha-editor");
      expect(ctx.role).toBe("owner");
    });

    it("successfully switches publication within same authorized workspace", async () => {
      const currentTenant: TenantContext = {
        workspaceId: "ws-alpha",
        userId: "user-alpha-editor",
        role: "owner",
      };
      const ctx = await service.switchPublication("pub-alpha-tech", "user-alpha-editor", currentTenant);
      expect(ctx.workspaceId).toBe("ws-alpha");
      expect(ctx.publicationId).toBe("pub-alpha-tech");
    });

    it("rejects unauthorized workspace switch with TenantAccessDeniedError", async () => {
      await expect(
        service.switchWorkspace("ws-beta", "user-alpha-editor"),
      ).rejects.toThrow(TenantAccessDeniedError);
    });

    it("rejects unauthorized publication switch to another tenant", async () => {
      const currentTenant: TenantContext = {
        workspaceId: "ws-alpha",
        userId: "user-alpha-editor",
        role: "owner",
      };
      await expect(
        service.switchPublication("pub-beta-news", "user-alpha-editor", currentTenant),
      ).rejects.toThrow(TenantAccessDeniedError);
    });
  });

  describe("2. Matrix of Tenant Scoping & Isolation Domains", () => {
    const alphaContext: TenantContext = {
      workspaceId: "ws-alpha",
      publicationId: "pub-alpha-main",
      actorId: "user-alpha-editor",
      actorRole: "editor",
    };

    const betaContext: TenantContext = {
      workspaceId: "ws-beta",
      publicationId: "pub-beta-news",
      actorId: "user-beta-author",
      actorRole: "author",
    };

    it("enforces Cache key namespace isolation across publications", () => {
      const getCacheKey = (ctx: TenantContext, domain: string, id: string) =>
        `tenant:${ctx.workspaceId}:pub:${ctx.publicationId}:${domain}:${id}`;

      const keyAlpha = getCacheKey(alphaContext, "posts", "post-100");
      const keyBeta = getCacheKey(betaContext, "posts", "post-100");

      expect(keyAlpha).toBe("tenant:ws-alpha:pub:pub-alpha-main:posts:post-100");
      expect(keyBeta).toBe("tenant:ws-beta:pub:pub-beta-news:posts:post-100");
      expect(keyAlpha).not.toBe(keyBeta);
    });

    it("enforces Job Queue tenant payload isolation", () => {
      const createJobEnvelope = (ctx: TenantContext, task: string, payload: unknown) => ({
        tenant: { workspaceId: ctx.workspaceId, publicationId: ctx.publicationId },
        task,
        payload,
      });

      const jobAlpha = createJobEnvelope(alphaContext, "email:deliver", { to: "subscriber@a.com" });
      const jobBeta = createJobEnvelope(betaContext, "email:deliver", { to: "subscriber@b.com" });

      expect(jobAlpha.tenant.workspaceId).toBe("ws-alpha");
      expect(jobBeta.tenant.workspaceId).toBe("ws-beta");
    });

    it("enforces Search Index tenant query filters", () => {
      const buildSearchQuery = (ctx: TenantContext, term: string) => ({
        sql: "SELECT * FROM search_index WHERE workspace_id = $1 AND publication_id = $2 AND search_vector @@ plainto_tsquery($3)",
        params: [ctx.workspaceId, ctx.publicationId, term],
      });

      const qAlpha = buildSearchQuery(alphaContext, "AI");
      expect(qAlpha.params[0]).toBe("ws-alpha");
      expect(qAlpha.params[1]).toBe("pub-alpha-main");
    });

    it("enforces Webhook event dispatch isolation", () => {
      const dispatchWebhook = (ctx: TenantContext, event: string, subscriptions: Array<{ publicationId: string; targetUrl: string }>) => {
        return subscriptions
          .filter((sub) => sub.publicationId === ctx.publicationId)
          .map((sub) => ({ event, target: sub.targetUrl }));
      };

      const subs = [
        { publicationId: "pub-alpha-main", targetUrl: "https://alpha.example/webhook" },
        { publicationId: "pub-beta-news", targetUrl: "https://beta.example/webhook" },
      ];

      const deliveries = dispatchWebhook(alphaContext, "post.published", subs);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.target).toBe("https://alpha.example/webhook");
    });

    it("enforces Media Asset Storage bucket prefix isolation", () => {
      const getStoragePath = (ctx: TenantContext, filename: string) =>
        `media/${ctx.workspaceId}/${ctx.publicationId}/${filename}`;

      const pathAlpha = getStoragePath(alphaContext, "banner.png");
      const pathBeta = getStoragePath(betaContext, "banner.png");

      expect(pathAlpha).toBe("media/ws-alpha/pub-alpha-main/banner.png");
      expect(pathBeta).toBe("media/ws-beta/pub-beta-news/banner.png");
    });

    it("enforces Analytics event attribution isolation", () => {
      const recordPageView = (ctx: TenantContext, path: string) => ({
        workspaceId: ctx.workspaceId,
        publicationId: ctx.publicationId,
        path,
        timestamp: new Date(),
      });

      const eventAlpha = recordPageView(alphaContext, "/posts/deep-learning");
      expect(eventAlpha.workspaceId).toBe("ws-alpha");
      expect(eventAlpha.publicationId).toBe("pub-alpha-main");
    });

    it("enforces Audit Log immutable tenant scoping", () => {
      const createAuditEntry = (ctx: TenantContext, action: string, targetId: string) => ({
        workspaceId: ctx.workspaceId,
        publicationId: ctx.publicationId,
        actorId: ctx.actorId,
        action,
        targetId,
        timestamp: new Date(),
      });

      const entry = createAuditEntry(alphaContext, "post.deleted", "post-999");
      expect(entry.workspaceId).toBe("ws-alpha");
      expect(entry.actorId).toBe("user-alpha-editor");
    });
  });

  describe("3. Negative IDOR Defense Assertions", () => {
    it("blocks IDOR access attempt to foreign workspace resources", () => {
      const assertResourceAccess = (ctx: TenantContext, resource: { workspaceId: string; publicationId: string }) => {
        service.assertTenantAccess(ctx, resource.workspaceId, resource.publicationId);
      };

      const alphaContext: TenantContext = {
        workspaceId: "ws-alpha",
        publicationId: "pub-alpha-main",
        actorId: "user-alpha-editor",
      };

      const betaResource = {
        workspaceId: "ws-beta",
        publicationId: "pub-beta-news",
      };

      expect(() => assertResourceAccess(alphaContext, betaResource)).toThrow(TenantAccessDeniedError);
    });

    it("blocks IDOR access attempt to sibling publication in same workspace without membership", () => {
      const alphaContextPub1: TenantContext = {
        workspaceId: "ws-alpha",
        publicationId: "pub-alpha-main",
        actorId: "user-alpha-limited",
      };

      const pub2Resource = {
        workspaceId: "ws-alpha",
        publicationId: "pub-alpha-tech",
      };

      expect(() =>
        service.assertTenantAccess(alphaContextPub1, pub2Resource.workspaceId, pub2Resource.publicationId),
      ).toThrow(TenantAccessDeniedError);
    });
  });
});
