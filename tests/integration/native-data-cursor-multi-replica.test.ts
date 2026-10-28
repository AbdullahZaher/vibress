import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import {
  issueNativeCursor,
  readNativeCursor,
  nativeFilterHash,
  type NativeCursorContext,
} from "../../apps/api/src/plugins/native-data-cursor";
import { adminNativeDataRoutes } from "../../apps/api/src/routes/extension-native-data";

const sharedSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const rotatedSecret = "f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6b5a43210";
const digest = "c".repeat(64);
const label = { en: "Courses", ar: "Courses" };

const mockPluginModule: PluginModule = {
  activate() {},
  routes: [{
    id: "overview", audience: "admin", method: "GET",
    permission: "plugins.manage", response: { fields: { total: "number" } },
    handle: () => ({ total: 5 }),
  }],
  adminViews: [{ id: "overview", routeId: "overview", title: label }],
  adminNavigation: [{ viewId: "overview", label, permission: "plugins.manage" }],
  adminPages: [{
    schemaVersion: 1, viewId: "overview", title: label,
    components: [{ type: "stat", id: "total", field: "total", label }],
  }],
  adminResources: [{
    id: "courses", modelKey: "courses", fields: ["title_en", "status"],
    textFilters: ["status"],
  }],
  adminActions: [
    { id: "create-course", resourceId: "courses", operation: "create" },
    { id: "update-course", resourceId: "courses", operation: "update" },
  ],
};

const mockPhysicalModels = [{
  key: "courses", schemaSha256: "c".repeat(64),
  columns: [
    { name: "title_en", type: "text" as const, required: true },
    { name: "status", type: "text" as const, required: true },
  ],
  indexedTextFields: ["status"],
}];

// Shared underlying database storage across all API replicas
const sharedDatabaseState = {
  pluginEnabled: true,
  useRotatedSecret: false,
  rows: [
    { id: "course-01", version: 1, fields: { title_en: "Intro to TypeScript", status: "draft" } },
    { id: "course-02", version: 1, fields: { title_en: "Advanced Fastify", status: "draft" } },
    { id: "course-03", version: 1, fields: { title_en: "Distributed Systems", status: "draft" } },
    { id: "course-04", version: 1, fields: { title_en: "Cryptography at Scale", status: "draft" } },
    { id: "course-05", version: 1, fields: { title_en: "PostgreSQL Internals", status: "published" } },
  ],
};

vi.mock("@vibress/config", () => ({
  getConfig: () => ({
    nativeAdminUiReleases: sharedDatabaseState.pluginEnabled ? ["sample-plugin@" + digest] : [],
    nativeAdminActionReleases: sharedDatabaseState.pluginEnabled ? ["sample-plugin@" + digest] : [],
    secrets: {
      encryptionKey: sharedDatabaseState.useRotatedSecret ? rotatedSecret : sharedSecret,
    },
  }),
}));

vi.mock("../../apps/api/src/middleware/auth", () => ({
  requireStaffSession: async (req: FastifyRequest, reply: FastifyReply) => {
    const unauthenticated = req.headers["x-unauthenticated"] === "true";
    if (unauthenticated) {
      return reply.code(401).send({ errors: [{ code: "UNAUTHENTICATED" }] });
    }
    const publicationId = (req.headers["x-publication-id"] as string) || "pub-primary";
    const actorId = (req.headers["x-actor-id"] as string) || "staff-editor";
    const role = (req.headers["x-role"] as string) || "owner";

    Object.assign(req, {
      user: { id: actorId },
      roles: ["owner"],
      permissions: ["plugins.manage"],
      publicationContext: {
        publicationId,
        workspaceId: "workspace-1",
        role,
        actorType: "staff",
        isSystemOperation: false,
      },
    });
  },
  validateOrigin: async () => {},
}));

vi.mock("../../apps/api/src/services", () => ({
  pluginsService: {
    listOperatorAdminFingerprints: async () =>
      sharedDatabaseState.pluginEnabled ? new Map([["sample-plugin", digest]]) : new Map(),
    resolveExtensionApiModule: async () => (sharedDatabaseState.pluginEnabled ? mockPluginModule : null),
    resolveExtensionStorageBinding: async (_pluginId: string, publicationId: string) => ({
      pluginId: "sample-plugin",
      publicationId,
      models: mockPhysicalModels,
    }),
    prepareExtensionApiExecution: async () => true,
  },
}));

vi.mock("@vibress/plugins", () => ({
  PluginDomainError: class PluginDomainError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  },
  createHostPluginStorageSession: () => {
    const list = (limit: number, cursor?: string, field?: string, value?: string) => {
      const sorted = [...sharedDatabaseState.rows]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter(
          (row) =>
            (!cursor || row.id > cursor) &&
            (!field || row.fields[field] === value)
        );
      const items = sorted.slice(0, limit).map((row) => ({ ...row }));
      const last = items[items.length - 1];
      return sorted.length > limit && last ? { items, nextCursor: last.id } : { items };
    };
    return {
      storage: {
        list: async (_model: string, limit: number, cursor?: string) => list(limit, cursor),
        listByText: async (_model: string, field: string, value: string, limit: number, cursor?: string) =>
          list(limit, cursor, field, value),
        create: async () => ({ id: "new", version: 1, fields: {} }),
        update: async () => ({ id: "updated", version: 2, fields: {} }),
      },
      close: async () => {},
    };
  },
}));

describe("NUI-06 Cryptographic cursor continuity and secret rotation", () => {
  const context: NativeCursorContext = {
    pluginId: "lms-authoring",
    publicationId: "pub-primary",
    actorId: "staff-editor",
    resourceId: "courses",
    digest,
    filterHash: nativeFilterHash("status", "draft"),
  };

  it("allows Replica 2 to decrypt and decode a cursor issued by Replica 1 with identical shared secret", () => {
    const issuedAt = 1_000_000;
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const receivedAt = issuedAt + 5_000;
    const decodedId = readNativeCursor(cursor, context, sharedSecret, receivedAt);
    expect(decodedId).toBe("course-row-42");
  });

  it("fails closed across replicas when secret has been rotated without backward grace period", () => {
    const issuedAt = 1_000_000;
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const decodedId = readNativeCursor(cursor, context, rotatedSecret, issuedAt + 1_000);
    expect(decodedId).toBeNull();
  });

  it("rejects cursor replay across different publications even with identical shared key", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const crossPubContext: NativeCursorContext = {
      ...context,
      publicationId: "pub-secondary",
    };
    expect(readNativeCursor(cursor, crossPubContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("rejects cursor replay across different actors/staff sessions", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const crossActorContext: NativeCursorContext = {
      ...context,
      actorId: "staff-malicious",
    };
    expect(readNativeCursor(cursor, crossActorContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("rejects cursor reuse when filter parameter changes", () => {
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, 1_000_000);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const differentFilterContext: NativeCursorContext = {
      ...context,
      filterHash: nativeFilterHash("status", "published"),
    };
    expect(readNativeCursor(cursor, differentFilterContext, sharedSecret, 1_001_000)).toBeNull();
  });

  it("expires cursors after 15 minutes TTL", () => {
    const issuedAt = 1_000_000;
    const cursor = issueNativeCursor(context, "course-row-42", sharedSecret, issuedAt);
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error("Cursor issuance failed");

    const expiredAt = issuedAt + 15 * 60 * 1000 + 1;
    expect(readNativeCursor(cursor, context, sharedSecret, expiredAt)).toBeNull();
  });
});

describe("NUI-06 Live Multi-Replica Fastify API Acceptance Across Distinct TCP Ports", () => {
  let replicaA: FastifyInstance;
  let replicaB: FastifyInstance;
  let portA: number;
  let portB: number;

  beforeAll(async () => {
    // 1. Start two distinct Fastify API instances listening on separate real OS ports
    replicaA = Fastify();
    await replicaA.register(adminNativeDataRoutes);
    await replicaA.listen({ port: 0, host: "127.0.0.1" });
    portA = (replicaA.server.address() as AddressInfo).port;

    replicaB = Fastify();
    await replicaB.register(adminNativeDataRoutes);
    await replicaB.listen({ port: 0, host: "127.0.0.1" });
    portB = (replicaB.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await Promise.all([replicaA.close(), replicaB.close()]);
  });

  it("proves real multi-replica continuity: cursor issued on Replica A is consumed on Replica B", async () => {
    // Fetch Page 1 from Replica A
    const resA = await fetch(`http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=2`, {
      headers: {
        "x-publication-id": "pub-primary",
        "x-actor-id": "staff-editor",
      },
    });
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { items: Array<{ id: string }>; nextCursor?: string };
    expect(bodyA.items).toHaveLength(2);
    expect(bodyA.items.map((i) => i.id)).toEqual(["course-01", "course-02"]);
    expect(bodyA.nextCursor).toBeDefined();

    const cursorFromA = bodyA.nextCursor!;

    // Fetch Page 2 from Replica B using the cursor generated by Replica A
    const resB = await fetch(
      `http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses?limit=2&cursor=${encodeURIComponent(cursorFromA)}`,
      {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      }
    );
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as { items: Array<{ id: string }>; nextCursor?: string };
    expect(bodyB.items).toHaveLength(2);
    expect(bodyB.items.map((i) => i.id)).toEqual(["course-03", "course-04"]);
    expect(bodyB.nextCursor).toBeDefined();

    const cursorFromB = bodyB.nextCursor!;

    // Fetch Page 3 from Replica A using the cursor generated by Replica B
    const resA2 = await fetch(
      `http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=2&cursor=${encodeURIComponent(cursorFromB)}`,
      {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      }
    );
    expect(resA2.status).toBe(200);
    const bodyA2 = (await resA2.json()) as { items: Array<{ id: string }>; nextCursor?: string };
    expect(bodyA2.items).toHaveLength(1);
    expect(bodyA2.items[0]?.id).toBe("course-05");
    expect(bodyA2.nextCursor).toBeUndefined();
  });

  it("fails closed when Replica B receives a cursor with altered publication ID", async () => {
    // Generate valid cursor on Replica A for publication "pub-primary"
    const resA = await fetch(`http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=2`, {
      headers: {
        "x-publication-id": "pub-primary",
        "x-actor-id": "staff-editor",
      },
    });
    const bodyA = (await resA.json()) as { nextCursor: string };

    // Present cursor to Replica B under unauthorized publication "pub-hostile"
    const resB = await fetch(
      `http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses?limit=2&cursor=${encodeURIComponent(bodyA.nextCursor)}`,
      {
        headers: {
          "x-publication-id": "pub-hostile",
          "x-actor-id": "staff-editor",
        },
      }
    );
    // Invalid cursor HMAC for cross-publication context must fail closed
    expect(resB.status).toBe(400);
    const err = (await resB.json()) as { errors: Array<{ code: string }> };
    expect(err.errors[0]?.code).toBe("INVALID_CURSOR");
  });

  it("fails closed when Replica B receives a cursor with altered actor ID", async () => {
    const resA = await fetch(`http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=2`, {
      headers: {
        "x-publication-id": "pub-primary",
        "x-actor-id": "staff-editor",
      },
    });
    const bodyA = (await resA.json()) as { nextCursor: string };

    const resB = await fetch(
      `http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses?limit=2&cursor=${encodeURIComponent(bodyA.nextCursor)}`,
      {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-attacker",
        },
      }
    );
    expect(resB.status).toBe(400);
    const err = (await resB.json()) as { errors: Array<{ code: string }> };
    expect(err.errors[0]?.code).toBe("INVALID_CURSOR");
  });

  it("fails closed when Replica B receives a cursor with altered filter params", async () => {
    // Cursor generated with filter status=draft
    const resA = await fetch(
      `http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=1&filterField=status&filterValue=draft`,
      {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      }
    );
    const bodyA = (await resA.json()) as { nextCursor: string };

    // Attacker modifies query filter to status=published while replaying cursor
    const resB = await fetch(
      `http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses?limit=1&filterField=status&filterValue=published&cursor=${encodeURIComponent(bodyA.nextCursor)}`,
      {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      }
    );
    expect(resB.status).toBe(400);
    const err = (await resB.json()) as { errors: Array<{ code: string }> };
    expect(err.errors[0]?.code).toBe("INVALID_CURSOR");
  });

  it("fails closed across replicas when a replica has a mismatched/rotated signing secret", async () => {
    // Generate valid cursor on Replica A with sharedSecret
    const resA = await fetch(`http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses?limit=2`, {
      headers: {
        "x-publication-id": "pub-primary",
        "x-actor-id": "staff-editor",
      },
    });
    const bodyA = (await resA.json()) as { nextCursor: string };
    expect(bodyA.nextCursor).toBeDefined();

    // Replica with rotated/mismatched secret receives the cursor
    sharedDatabaseState.useRotatedSecret = true;
    try {
      const resB = await fetch(
        `http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses?limit=2&cursor=${encodeURIComponent(bodyA.nextCursor)}`,
        {
          headers: {
            "x-publication-id": "pub-primary",
            "x-actor-id": "staff-editor",
          },
        }
      );
      expect(resB.status).toBe(400);
      const err = (await resB.json()) as { errors: Array<{ code: string }> };
      expect(err.errors[0]?.code).toBe("INVALID_CURSOR");
    } finally {
      sharedDatabaseState.useRotatedSecret = false;
    }
  });

  it("immediately denies access on both replicas when plugin is revoked or unallowed", async () => {
    sharedDatabaseState.pluginEnabled = false;
    try {
      const resA = await fetch(`http://127.0.0.1:${portA}/extensions/sample-plugin/resources/courses`, {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      });
      expect(resA.status).toBe(404);

      const resB = await fetch(`http://127.0.0.1:${portB}/extensions/sample-plugin/resources/courses`, {
        headers: {
          "x-publication-id": "pub-primary",
          "x-actor-id": "staff-editor",
        },
      });
      expect(resB.status).toBe(404);
    } finally {
      sharedDatabaseState.pluginEnabled = true;
    }
  });
});
