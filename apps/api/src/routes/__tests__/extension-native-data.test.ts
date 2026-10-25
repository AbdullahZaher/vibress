import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { ExtensionNativeDataPageV1Schema } from "@vibress/api-contracts";
import { adminNativeDataRoutes } from "../extension-native-data";

const state = vi.hoisted(() => ({
  authenticated: true,
  publicationId: "publication-a",
  publicationRole: "owner",
  actorId: "staff-owner",
  readAllowed: true,
  writeAllowed: false,
  ready: true,
  hasModel: true,
  closeFails: false,
  rows: [] as Array<{
    id: string; version: number;
    fields: Record<string, string | number | boolean | null>;
  }>,
  activeModule: null as PluginModule | null,
}));
const digest = "a".repeat(64);
const label = { en: "Courses", ar: "Courses" };
const pluginModule: PluginModule = {
  activate() {},
  routes: [{
    id: "overview", audience: "admin", method: "GET",
    permission: "plugins.manage", response: { fields: { total: "number" } },
    handle: () => ({ total: 1 }),
  }],
  adminViews: [{ id: "overview", routeId: "overview", title: label }],
  adminNavigation: [{ viewId: "overview", label, permission: "plugins.manage" }],
  adminPages: [{
    schemaVersion: 1, viewId: "overview", title: label,
    components: [{ type: "stat", id: "total", field: "total", label }],
  }],
  adminResources: [{
    id: "courses", modelKey: "courses", fields: ["title_en"],
    textFilters: ["title_en"],
  }],
  adminActions: [
    { id: "create-course", resourceId: "courses", operation: "create" },
    { id: "update-course", resourceId: "courses", operation: "update" },
  ],
};
const models = [{
  key: "courses", schemaSha256: "c".repeat(64),
  columns: [
    { name: "title_en", type: "text" as const, required: true },
    { name: "internal_private", type: "text" as const, required: false },
  ],
  indexedTextFields: ["title_en"],
}];

vi.mock("@vibress/config", () => ({
  getConfig: () => ({
    nativeAdminUiReleases: state.readAllowed ? ["sample-plugin@" + digest] : [],
    nativeAdminActionReleases: state.writeAllowed ? ["sample-plugin@" + digest] : [],
    secrets: { encryptionKey: "d".repeat(64) },
  }),
}));
vi.mock("../../middleware/auth", () => ({
  requireStaffSession: async (req: FastifyRequest, reply: FastifyReply) => {
    if (!state.authenticated) return reply.code(401).send({ errors: [{ code: "UNAUTHENTICATED" }] });
    Object.assign(req, {
      user: { id: state.actorId },
      roles: ["owner"], permissions: ["plugins.manage"],
      publicationContext: {
        publicationId: state.publicationId,
        workspaceId: "workspace-1",
        role: state.publicationRole,
        actorType: "staff", isSystemOperation: false,
      },
    });
  },
  validateOrigin: async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === "POST" && req.headers.origin !== "http://localhost:7777") {
      return reply.code(403).send({ errors: [{ code: "ORIGIN_DENIED" }] });
    }
  },
}));
vi.mock("../../services", () => ({
  pluginsService: {
    listOperatorAdminFingerprints: async () => new Map([["sample-plugin", digest]]),
    resolveExtensionApiModule: async () => state.activeModule,
    resolveExtensionStorageBinding: async (
      _pluginId: string, publicationId: string, _capability: string,
    ) => state.hasModel ? {
      pluginId: "sample-plugin", publicationId, models,
    } : null,
    prepareExtensionApiExecution: async () => state.ready,
  },
}));
vi.mock("@vibress/plugins", () => ({
  PluginDomainError: class PluginDomainError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
  createHostPluginStorageSession: () => {
    const list = (limit: number, cursor?: string, field?: string, value?: string) => {
      const sorted = [...state.rows].sort((a, b) => a.id.localeCompare(b.id))
        .filter((row) => (!cursor || row.id > cursor) &&
          (!field || row.fields[field] === value));
      const items = sorted.slice(0, limit).map((row) => ({ ...row }));
      const last = items[items.length - 1];
      return sorted.length > limit && last
        ? { items, nextCursor: last.id } : { items };
    };
    const conflict = (code: string) => Object.assign(new Error(code), { code });
    return {
      storage: {
        list: async (_model: string, limit: number, cursor?: string) => list(limit, cursor),
        listByText: async (_model: string, field: string, value: string,
          limit: number, cursor?: string) => list(limit, cursor, field, value),
        create: async (_model: string, id: string,
          fields: Readonly<Record<string, string | number | boolean | null>>) => {
          if (state.rows.some((row) => row.id === id)) throw conflict("PLUGIN_STORAGE_CONFLICT");
          const row = { id, version: 1, fields: { ...fields } };
          state.rows.push(row);
          return row;
        },
        update: async (_model: string, id: string, expectedVersion: number,
          fields: Readonly<Record<string, string | number | boolean | null>>) => {
          const row = state.rows.find((entry) => entry.id === id);
          if (!row) throw conflict("PLUGIN_STORAGE_NOT_FOUND");
          if (row.version !== expectedVersion) throw conflict("PLUGIN_STORAGE_CONFLICT");
          row.version += 1;
          Object.assign(row.fields, fields);
          return row;
        },
      },
      close: async () => {
        if (state.closeFails) throw new Error("Simulated finalization failure");
      },
    };
  },
}));

describe("NUI-03 Fastify resource/action boundary", () => {
  let app: FastifyInstance;
  const base = "/extensions/sample-plugin";
  const origin = { origin: "http://localhost:7777" };
  beforeAll(async () => {
    app = Fastify();
    await app.register(adminNativeDataRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    state.authenticated = true;
    state.publicationId = "publication-a";
    state.publicationRole = "owner";
    state.actorId = "staff-owner";
    state.readAllowed = true;
    state.writeAllowed = false;
    state.ready = true;
    state.hasModel = true;
    state.closeFails = false;
    state.rows = [];
    state.activeModule = pluginModule;
  });

  it("requires Staff and rejects external tenant selectors", async () => {
    state.authenticated = false;
    expect((await app.inject({ method: "GET", url: base + "/data" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: base + "/actions/create-course",
      headers: origin, payload: { id: "course-1", fields: { title_en: "Title" } },
    })).statusCode).toBe(401);
    state.authenticated = true;
    expect((await app.inject({ method: "GET",
      url: base + "/resources/courses?publicationId=foreign",
    })).statusCode).toBe(400);
    state.publicationRole = "author";
    expect((await app.inject({ method: "GET",
      url: base + "/resources/courses",
    })).statusCode).toBe(403);
  });

  it("projects only approved fields and binds pagination to Staff/publication", async () => {
    state.rows = [
      { id: "c1", version: 1, fields: { title_en: "<unsafe>", internal_private: "secret" } },
      { id: "c2", version: 1, fields: { title_en: "Second" } },
    ];
    const first = await app.inject({
      method: "GET", url: base + "/resources/courses?limit=1",
    });
    expect(first.statusCode).toBe(200);
    const payload = ExtensionNativeDataPageV1Schema.parse(first.json());
    if (!payload.nextCursor) throw Error("Expected signed nextCursor");
    expect(payload.schemaVersion).toBe(1);
    expect(payload.items[0]?.fields).toEqual({ title_en: "<unsafe>" });
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload.nextCursor).not.toBe("c1");
    const second = await app.inject({
      method: "GET", url: base + "/resources/courses?limit=1&cursor=" + payload.nextCursor,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).toBe("c2");
    state.publicationId = "publication-b";
    expect((await app.inject({
      method: "GET", url: base + "/resources/courses?limit=1&cursor=" + payload.nextCursor,
    })).statusCode).toBe(400);
    state.publicationId = "publication-a";
    state.actorId = "different-staff";
    expect((await app.inject({
      method: "GET", url: base + "/resources/courses?limit=1&cursor=" + payload.nextCursor,
    })).statusCode).toBe(400);
  });

  it("requires distinct write approval, Origin and versioned CAS", async () => {
    const payload = { id: "course-1", fields: { title_en: "First" } };
    const path = base + "/actions/create-course";
    expect((await app.inject({ method: "POST", url: path, headers: origin,
      payload })).statusCode).toBe(404);
    state.writeAllowed = true;
    expect((await app.inject({ method: "POST", url: path, payload })).statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: path, headers: origin, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json().record.version).toBe(1);
    expect((await app.inject({ method: "POST", url: path, headers: origin,
      payload })).statusCode).toBe(409);
    const update = base + "/actions/update-course";
    expect((await app.inject({ method: "POST", url: update, headers: origin,
      payload: { ...payload, expectedVersion: 1, fields: { title_en: "Updated" } },
    })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: update, headers: origin,
      payload: { ...payload, expectedVersion: 1, fields: { title_en: "Stale" } },
    })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: update, headers: origin,
      payload })).statusCode).toBe(400);
    expect(state.rows[0]?.fields.title_en).toBe("Updated");
  });

  it("fails closed when an admitted model or execution is revoked", async () => {
    state.hasModel = false;
    expect((await app.inject({ method: "GET",
      url: base + "/resources/courses",
    })).statusCode).toBe(404);
    state.hasModel = true;
    state.ready = false;
    expect((await app.inject({ method: "GET",
      url: base + "/resources/courses",
    })).statusCode).toBe(404);
    state.ready = true;
    state.readAllowed = false;
    expect((await app.inject({ method: "GET",
      url: base + "/data",
    })).statusCode).toBe(404);
  });

  it("never returns a successful read after storage finalization fails", async () => {
    state.rows = [{ id: "course-1", version: 1, fields: { title_en: "Existing" } }];
    state.closeFails = true;
    expect((await app.inject({ method: "GET",
      url: base + "/resources/courses",
    })).statusCode).toBe(503);
  });
});
