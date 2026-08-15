import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";

describe("Health & Version Metadata API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns version and commit metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
    expect(body.commit).toBeDefined();
    expect(body.environment).toBeDefined();
  });

  it("GET /api/health returns version and commit metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
  });

  it("GET /api returns API name and version info", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Vibress API");
    expect(body.version).toBeDefined();
  });
});
