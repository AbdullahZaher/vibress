import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { adminExtensionNavigationRoutes } from "../extension-admin-views";

const state = vi.hoisted(() => ({
  authenticated: true,
  publicationId: "publication-a",
  role: "owner",
  readApproved: true,
  writeApproved: false,
  writeStorageAllowed: true,
  digest: "a".repeat(64),
  module: null as PluginModule | null,
  loaded: 0,
}));

const label = { en: "Courses", ar: "الدورات" };
function fixture(): PluginModule {
  return {
    activate() {},
    routes: [
      { id: "courses", audience: "admin", method: "GET", permission: "plugins.manage",
        response: { fields: { total: "number" } },
        handle: () => ({ total: 1 }) },
      { id: "courses", audience: "admin", method: "POST", permission: "plugins.manage",
        body: { fields: { courseId: "string", expectedVersion: "number",
          operation: "string", title_en: "string" },
        required: ["courseId", "expectedVersion", "operation", "title_en"] },
        response: { fields: { outcome: "string", courseId: "string",
          version: "number", status: "string" } },
        handle: () => ({ outcome: "created", courseId: "course-one", version: 1, status: "draft" }) },
    ],
    adminViews: [{ id: "course-overview", routeId: "courses", title: label }],
    adminNavigation: [{ viewId: "course-overview", label, permission: "plugins.manage" }],
    adminPages: [{ schemaVersion: 1, viewId: "course-overview", title: label,
      components: [{ type: "stat", id: "total", label, field: "total" }] }],
    adminResources: [{ id: "course-records", viewId: "course-overview", modelKey: "courses",
      fields: ["title_en", "status"] }],
    adminDomainWorkflows: [{ schemaVersion: 1,
      viewId: "course-overview", routeId: "courses", resourceId: "course-records",
      idField: "courseId", versionField: "expectedVersion", operationField: "operation",
      operations: ["create", "save", "publish"],
      fields: [{ key: "title_en", label, maxLength: 180 }] }],
  };
}
vi.mock("@vibress/config", () => ({
  getConfig: () => ({
    nativeAdminUiReleases: state.readApproved ? ["sample-plugin@" + "a".repeat(64)] : [],
    nativeAdminActionReleases: state.writeApproved ? ["sample-plugin@" + "a".repeat(64)] : [],
  }),
}));
vi.mock("@vibress/plugins", () => ({
  PluginDomainError: class PluginDomainError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock("../../middleware/auth", () => ({
  requireStaffSession: async (req: FastifyRequest, reply: FastifyReply) => {
    if (!state.authenticated) {
      return reply.status(401).send({ errors: [{ code: "UNAUTHENTICATED" }] });
    }
    Object.assign(req, { user: { id: "staff-a" }, permissions: ["plugins.manage"],
      roles: ["owner"], publicationContext: {
        publicationId: state.publicationId, workspaceId: "workspace-a",
        role: state.role, actorType: "staff", isSystemOperation: false,
      },
    });
  },
  validateOrigin: async () => undefined,
}));
vi.mock("../../services", () => ({
  pluginsService: {
    listOperatorAdminFingerprints: async () => new Map([["sample-plugin", state.digest]]),
    resolveExtensionApiModule: async () => {
      state.loaded += 1;
      return state.module;
    },
    resolveExtensionStorageBinding: async (_plugin: string, publicationId: string) =>
      state.writeStorageAllowed ? {
        pluginId: "sample-plugin", publicationId, models: [{ key: "courses",
          columns: [{ name: "title_en", type: "text", required: true },
            { name: "status", type: "text", required: true }],
          indexedTextFields: [],
        }],
      } : null,
  },
}));
vi.mock("../../observability", () => ({ appLogger: { warn: vi.fn() } }));

describe("NUI-05 Host Native domain write admission", () => {
  let app: FastifyInstance;
  const url = "/extensions/sample-plugin/views/course-overview/native";
  beforeAll(async () => {
    app = Fastify();
    await app.register(adminExtensionNavigationRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    state.authenticated = true; state.publicationId = "publication-a";
    state.role = "owner"; state.readApproved = true;
    state.writeApproved = false; state.writeStorageAllowed = true;
    state.digest = "a".repeat(64); state.module = fixture(); state.loaded = 0;
  });

  it("never probes plugin modules without Staff authentication", async () => {
    state.authenticated = false;
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(401);
    expect(state.loaded).toBe(0);
  });
  it("keeps read-only Native pages inert without independent write consent", async () => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe("native");
    expect(response.json().workflow).toBeUndefined();
  });
  it("admits a linked workflow only with both operator approvals and storage", async () => {
    state.writeApproved = true;
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.json().workflow).toMatchObject({
      viewId: "course-overview", routeId: "courses",
      resourceId: "course-records", operations: ["create", "save", "publish"],
    });
    state.writeStorageAllowed = false;
    const denied = await app.inject({ method: "GET", url });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().workflow).toBeUndefined();
  });
  it("denies a local author even with a global owner role", async () => {
    state.role = "author"; state.writeApproved = true;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
  });
  it("removes Native admission for missing read approval or mismatched release", async () => {
    state.readApproved = false; state.writeApproved = true;
    expect((await app.inject({ method: "GET", url })).json()).toEqual({ mode: "legacy" });
    state.readApproved = true; state.digest = "b".repeat(64);
    expect((await app.inject({ method: "GET", url })).json()).toEqual({ mode: "legacy" });
    expect(state.loaded).toBe(0);
  });
  it("fails closed for malformed paired descriptors instead of exposing edit controls", async () => {
    state.writeApproved = true;
    const module = fixture();
    const original = module.adminDomainWorkflows?.[0];
    if (!original) throw Error("Invalid test fixture");
    state.module = { ...module, adminDomainWorkflows: [{ ...original, resourceId: "foreign" }] };
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(503);
    expect(response.json().workflow).toBeUndefined();
  });
});
