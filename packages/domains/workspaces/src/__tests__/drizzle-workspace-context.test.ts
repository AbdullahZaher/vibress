import { describe, it, expect, beforeAll } from "vitest";
import { getDb, users, eq } from "@vibress/database";
import crypto from "node:crypto";
import {
  DrizzleWorkspaceRepository,
  DrizzlePublicationRepository,
  WorkspaceService,
  TenantAccessDeniedError,
} from "../index";

describe("Drizzle Workspace & Publication Context Resolution", () => {
  const wsRepo = new DrizzleWorkspaceRepository();
  const pubRepo = new DrizzlePublicationRepository();
  const service = new WorkspaceService(wsRepo, pubRepo);

  it("keeps workspace owner/admin access authorable through explicit publication memberships", async () => {
    const db = getDb();
    const runId = crypto.randomUUID().slice(0, 8);
    const workspaceId = `ws-membership-${runId}`;
    const ownerId = crypto.randomUUID();
    const adminId = crypto.randomUUID();

    await db.insert(users).values([
      {
        id: ownerId,
        email: `workspace-owner-${runId}@example.test`,
        name: "Workspace Owner",
        passwordHash: "test-only-placeholder",
        status: "active",
      },
      {
        id: adminId,
        email: `workspace-admin-${runId}@example.test`,
        name: "Workspace Admin",
        passwordHash: "test-only-placeholder",
        status: "active",
      },
    ]);

    try {
      await wsRepo.create({
        id: workspaceId,
        name: `Membership Test ${runId}`,
        slug: `membership-test-${runId}`,
        settings: {},
      });

      await wsRepo.addMember({
        id: crypto.randomUUID(),
        workspaceId,
        userId: ownerId,
        role: "owner",
      });

      const firstPublication = await pubRepo.create({
        id: `pub-membership-a-${runId}`,
        workspaceId,
        name: "Membership A",
        slug: `membership-a-${runId}`,
        primaryLocale: "en",
        settings: {},
      });
      const secondPublication = await pubRepo.create({
        id: `pub-membership-b-${runId}`,
        workspaceId,
        name: "Membership B",
        slug: `membership-b-${runId}`,
        primaryLocale: "en",
        settings: {},
      });

      const ownerFirst = await pubRepo.getMembership(
        firstPublication.id,
        ownerId,
      );
      const ownerSecond = await pubRepo.getMembership(
        secondPublication.id,
        ownerId,
      );
      expect(ownerFirst?.role).toBe("owner");
      expect(ownerSecond?.role).toBe("owner");

      await wsRepo.addMember({
        id: crypto.randomUUID(),
        workspaceId,
        userId: adminId,
        role: "admin",
      });

      const adminFirst = await pubRepo.getMembership(
        firstPublication.id,
        adminId,
      );
      const adminSecond = await pubRepo.getMembership(
        secondPublication.id,
        adminId,
      );
      expect(adminFirst?.role).toBe("admin");
      expect(adminSecond?.role).toBe("admin");
    } finally {
      await db.delete(users).where(eq(users.id, ownerId));
      await db.delete(users).where(eq(users.id, adminId));
    }
  });

  it("resolves default publication for system owner when unassigned", async () => {
    const ctx = await service.resolveStaffPublicationContext(
      "9404f351-9cc1-4aed-8014-9fba3ba8ff5f", // bootstrap owner
      undefined,
      ["owner"],
    );
    expect(ctx.publicationId).toBe("pub_default");
    expect(ctx.workspaceId).toBe("ws_default");
    expect(ctx.role).toBe("owner");
    expect(ctx.actorType).toBe("staff");
  });

  it("rejects unauthorized publication switch to another publication", async () => {
    // User attempts to switch to an unassigned publication "pub_random"
    await expect(
      service.resolveStaffPublicationContext(
        "author@vibress.local",
        "pub_random",
        ["author"],
      ),
    ).rejects.toThrow(TenantAccessDeniedError);
  });

  it("resolves public publication context by mapped domain", async () => {
    // Check non-existent domain in production (no fallback)
    await expect(
      service.resolvePublicPublicationContext({
        host: "unknown-publication.com",
        isDevFallbackAllowed: false,
      }),
    ).rejects.toThrow(/Publication not found for hostname/);
  });

  it("adversarial: unknown host NEVER falls back to pub_default even if isDevFallbackAllowed is true", async () => {
    await expect(
      service.resolvePublicPublicationContext({
        host: "adversary-unmapped-host.com",
        isDevFallbackAllowed: true,
      }),
    ).rejects.toThrow(/Publication not found for hostname: adversary-unmapped-host.com/);
  });

  it("allows dev fallback to pub_default only when isDevFallbackAllowed is true", async () => {
    const ctx = await service.resolvePublicPublicationContext({
      host: "localhost:3000",
      isDevFallbackAllowed: true,
    });
    expect(ctx.publicationId).toBe("pub_default");
    expect(ctx.workspaceId).toBe("ws_default");
    expect(ctx.actorType).toBe("public");
  });

  it("enforces explicit worker scope for jobs", async () => {
    // System scope
    const sysCtx = await service.resolveWorkerPublicationContext({
      scope: "system",
    });
    expect(sysCtx.isSystemOperation).toBe(true);
    expect(sysCtx.actorType).toBe("system");

    // Publication scope with valid pub_default
    const pubCtx = await service.resolveWorkerPublicationContext({
      scope: "publication",
      publicationId: "pub_default",
    });
    expect(pubCtx.publicationId).toBe("pub_default");
    expect(pubCtx.actorType).toBe("worker");
    expect(pubCtx.isSystemOperation).toBe(false);

    // Publication scope without publicationId throws
    await expect(
      service.resolveWorkerPublicationContext({
        scope: "publication",
      }),
    ).rejects.toThrow(/publication-scoped job must provide a publicationId/);
  });
});
