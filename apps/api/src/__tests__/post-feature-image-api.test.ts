import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import { postsService, mediaService, usersService } from "../services";
import { hashPassword } from "@vibress/security";
import { getDb, publications } from "@vibress/database";

describe("API: Post Feature Image & Unsplash Integration", () => {
  let app: FastifyInstance;
  let ownerCookie: string;
  let testUserId: string;
  let testMediaAssetA: any;
  let testMediaAssetB: any;
  let testPostA: any;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Ensure pub_tenant_b exists for isolation tests
    const db = getDb();
    await db
      .insert(publications)
      .values({
        id: "pub_tenant_b",
        workspaceId: "ws_default",
        name: "Tenant B Pub",
        slug: `tenant-b-${Date.now()}`,
        primaryLocale: "en",
      })
      .onConflictDoNothing();

    // Login as default owner
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const setCookie = loginRes.headers["set-cookie"];
    ownerCookie = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);

    // Create a staff user for authoring
    const pwHash = await hashPassword("AuthorPass123!");
    const user = await usersService.createUser({
      email: `fi.author.${Date.now()}@example.com`,
      name: "Feature Image Author",
      passwordHash: pwHash,
      status: "active",
    });
    testUserId = user.id;

    // Create 1x1 png buffer for media tests
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    // Create Media Asset in pub_default (Publication A)
    testMediaAssetA = await mediaService.uploadMedia(
      {
        publicationId: "pub_default",
        filename: "test-feature-a.png",
        mimeType: "image/png",
        buffer: pngBuffer,
        displayName: "Feature Asset A",
        uploadedBy: testUserId,
        assetType: "image",
      },
      testUserId,
      "pub_default",
    );

    // Create Media Asset in pub_other (Publication B)
    testMediaAssetB = await mediaService.uploadMedia(
      {
        publicationId: "pub_tenant_b",
        filename: "test-feature-b.png",
        mimeType: "image/png",
        buffer: pngBuffer,
        displayName: "Feature Asset B",
        uploadedBy: testUserId,
        assetType: "image",
      },
      testUserId,
      "pub_tenant_b",
    );

    // Create Post in pub_default
    testPostA = await postsService.createPost(
      {
        title: "Test Post For Feature Image",
        primaryAuthorId: testUserId,
        content: {
          version: 1,
          root: {
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", text: "Post body content..." }],
              },
            ],
          },
        },
      },
      testUserId,
      "pub_default",
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Unsplash Status Endpoint", () => {
    it("returns configured status for authenticated staff", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/integrations/unsplash/status",
        headers: {
          cookie: ownerCookie,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty("configured");
      expect(typeof data.configured).toBe("boolean");
    });

    it("rejects unauthenticated requests with 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/v1/integrations/unsplash/status",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /api/admin/v1/posts/:id/feature-image", () => {
    it("rejects unauthenticated request with 401", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${testPostA.id}/feature-image`,
        headers: {
          origin: "http://localhost:7779",
        },
        payload: {
          featureImageId: testMediaAssetA.id,
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("successfully sets feature image within same publication", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${testPostA.id}/feature-image`,
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          featureImageId: testMediaAssetA.id,
          featureImageAlt: "Custom Alt Text",
          featureImageCaption: "Photo credit line",
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.featureImageId).toBe(testMediaAssetA.id);
      expect(data.post.featureImageAlt).toBe("Custom Alt Text");
      expect(data.post.featureImageCaption).toBe("Photo credit line");
      expect(data.post.featureImage).toBeDefined();
      expect(data.post.featureImage.id).toBe(testMediaAssetA.id);
      expect(data.post.featureImage.url).toBeDefined();

      // Verify version was NOT bumped (optimistic locking untouched)
      expect(data.post.version).toBe(testPostA.version);
    });

    it("REJECTS cross-publication feature image assignment (Tenant Isolation)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${testPostA.id}/feature-image`,
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          featureImageId: testMediaAssetB.id,
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.errors[0]?.code).toBe("INVALID_FEATURE_IMAGE");
    });

    it("successfully removes feature image when set to null", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${testPostA.id}/feature-image`,
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          featureImageId: null,
          featureImageAlt: null,
          featureImageCaption: null,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.featureImageId).toBeNull();
      expect(data.post.featureImage).toBeNull();
    });
  });

  describe("GET /api/admin/v1/posts/:id with resolved Feature Image", () => {
    it("returns resolved feature image asset in post detail", async () => {
      // Set image first
      await app.inject({
        method: "PATCH",
        url: `/api/admin/v1/posts/${testPostA.id}/feature-image`,
        headers: {
          cookie: ownerCookie,
          origin: "http://localhost:7779",
        },
        payload: {
          featureImageId: testMediaAssetA.id,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/admin/v1/posts/${testPostA.id}`,
        headers: {
          cookie: ownerCookie,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.featureImageId).toBe(testMediaAssetA.id);
      expect(data.post.featureImage).toBeDefined();
      expect(data.post.featureImage.id).toBe(testMediaAssetA.id);
      expect(data.post.featureImage.url).toBeDefined();
    });
  });

  describe("Public Content Rendering Precedence", () => {
    it("serves explicit feature image in public post summary and detail", async () => {
      // Publish the post
      await postsService.publishPost(testPostA.id, testUserId, "pub_default");

      const res = await app.inject({
        method: "GET",
        url: `/api/content/v1/posts/${testPostA.slug}`,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.post.featureImage).toBeDefined();
      expect(data.post.featureImage.id).toBe(testMediaAssetA.id);
      expect(data.post.featureImage.url).toBeDefined();
      expect(data.post.seo.ogImage).toBe(data.post.featureImage.url);
    });
  });
});
