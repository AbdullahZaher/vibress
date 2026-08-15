import { FastifyInstance } from "fastify";

export async function openApiDocsRoutes(app: FastifyInstance): Promise<void> {
  const openApiSpec = {
    openapi: "3.1.0",
    info: {
      title: "Vibress Platform API",
      version: "1.0.0",
      description:
        "Comprehensive, type-safe API for Vibress Publishing Platform. Includes Public Content, Editorial Admin, Media, Members, Workspaces, and Custom Collections.",
      contact: {
        name: "Vibress Developer Platform",
        url: "https://vibress.com/developers",
      },
    },
    servers: [
      {
        url: "/api",
        description: "Standard API Gateway",
      },
    ],
    paths: {
      "/content/v1/posts": {
        get: {
          summary: "List published posts",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: {
            "200": {
              description: "List of published posts",
            },
          },
        },
      },
      "/content/v1/collections/{modelSlug}": {
        get: {
          summary: "List custom content collection entries",
          parameters: [
            { name: "modelSlug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "List of collection entries",
            },
          },
        },
      },
      "/admin/v1/auth/login": {
        post: {
          summary: "Staff login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                  required: ["email", "password"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Successful login session" },
          },
        },
      },
    },
  };

  // OpenAPI JSON Endpoint
  app.get("/api/docs/openapi.json", async (_req, reply) => {
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .send(openApiSpec);
  });

  // Swagger UI HTML Documentation Endpoint
  app.get("/api/docs", async (_req, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Vibress Developer API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true
    });
  </script>
</body>
</html>`;
    return reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });
}
