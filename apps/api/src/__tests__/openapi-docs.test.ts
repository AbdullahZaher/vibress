import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../main";

describe("Developer Platform OpenAPI 3.1 & Documentation Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves valid OpenAPI 3.1 schema specification on /api/docs/openapi.json", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/docs/openapi.json",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const schema = JSON.parse(res.body);
    expect(schema.openapi).toBe("3.1.0");
    expect(schema.info.title).toBe("Vibress Platform API");
    expect(schema.paths).toHaveProperty("/content/v1/posts");
    expect(schema.paths).toHaveProperty("/admin/v1/auth/login");
  });

  it("serves Swagger UI HTML documentation on /api/docs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/docs",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Vibress Developer API Docs");
    expect(res.body).toContain("swagger-ui");
  });
});
