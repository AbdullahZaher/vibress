import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { storageRoutes } from "../routes/storage";
import { DrizzleStorageRepository } from "@vibress/storage-domain";
import { getDb, users } from "@vibress/database";

const repo = new DrizzleStorageRepository();

describe("API Security — Media Uploads & Direct Upload Hardening", () => {
  let app: FastifyInstance;
  const currentUserId = "test-user-1";

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(users)
      .values([
        {
          id: "test-user-1",
          email: "test-user-1@vibress.local",
          name: "Test User 1",
          slug: "test-user-1",
          status: "active",
          passwordHash: "dummy-hash-1",
        },
        {
          id: "test-user-2",
          email: "test-user-2@vibress.local",
          name: "Test User 2",
          slug: "test-user-2",
          status: "active",
          passwordHash: "dummy-hash-2",
        },
      ])
      .onConflictDoNothing();

    app = Fastify();
    app.decorateRequest("user", undefined);
    app.decorateRequest("roles", undefined);
    app.decorateRequest("permissions", undefined);
    app.addHook("preHandler", async (req) => {
      (req as any).user = {
        id: currentUserId,
        email: "admin@vibress.local",
        roleId: "role-admin",
        role: "admin",
      };
      (req as any).roles = ["admin"];
      (req as any).permissions = ["media.upload", "storage.manage"];
    });

    await app.register(storageRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects direct upload initiation with dangerous file extension (.sh, .exe, .js)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/initiate",
      payload: {
        originalFilename: "malicious.sh",
        declaredMime: "application/x-sh",
        expectedSize: 1024,
        assetType: "file",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("MEDIA_TYPE_NOT_ALLOWED");
  });

  it("rejects direct upload initiation with forbidden executable MIME type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/initiate",
      payload: {
        originalFilename: "image.png",
        declaredMime: "application/x-executable",
        expectedSize: 2048,
        assetType: "image",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("MEDIA_TYPE_NOT_ALLOWED");
  });

  it("rejects direct upload initiation with non-positive expected size", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/initiate",
      payload: {
        originalFilename: "photo.jpg",
        declaredMime: "image/jpeg",
        expectedSize: 0,
        assetType: "image",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects direct upload complete when upload session does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: {
        uploadSessionId: "nonexistent-session-id",
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("STORAGE_UPLOAD_INVALID");
  });

  it("enforces actor ownership on direct upload complete", async () => {
    const session = await repo.createUploadSession({
      actorId: "test-user-2",
      storageKey: "media/test-direct-owner/photo.png",
      originalFilename: "photo.png",
      declaredMime: "image/png",
      expectedSize: 500,
      assetType: "image",
      expiresAt: new Date(Date.now() + 600000),
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("FORBIDDEN");
  });

  it("rejects direct upload complete when session is not in pending state", async () => {
    const session = await repo.createUploadSession({
      actorId: "test-user-1",
      storageKey: "media/test-direct-state/photo.png",
      originalFilename: "photo.png",
      declaredMime: "image/png",
      expectedSize: 500,
      assetType: "image",
      expiresAt: new Date(Date.now() + 600000),
    });
    await repo.updateUploadSessionState(session.id, "failed");

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("STORAGE_UPLOAD_INVALID");
  });

  it("rejects direct upload complete when session is expired", async () => {
    const session = await repo.createUploadSession({
      actorId: "test-user-1",
      storageKey: "media/test-direct-exp/photo.png",
      originalFilename: "photo.png",
      declaredMime: "image/png",
      expectedSize: 500,
      assetType: "image",
      expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("STORAGE_UPLOAD_EXPIRED");
  });

  it("enforces actor ownership on multipart upload complete", async () => {
    const session = await repo.createUploadSession({
      actorId: "test-user-2",
      storageKey: "media/test-mp-owner/video.mp4",
      originalFilename: "video.mp4",
      declaredMime: "video/mp4",
      expectedSize: 5000,
      assetType: "video",
      expiresAt: new Date(Date.now() + 600000),
      multipartUploadId: "mp-upload-owner-test",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/complete",
      payload: {
        uploadSessionId: session.id,
        parts: [{ partNumber: 1, etag: "tag-1" }],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("FORBIDDEN");
  });

  it("enforces actor ownership on multipart abort", async () => {
    const session = await repo.createUploadSession({
      actorId: "test-user-2",
      storageKey: "media/test-mp-abort/video.mp4",
      originalFilename: "video.mp4",
      declaredMime: "video/mp4",
      expectedSize: 5000,
      assetType: "video",
      expiresAt: new Date(Date.now() + 600000),
      multipartUploadId: "mp-upload-abort-test",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/abort",
      payload: {
        uploadSessionId: session.id,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("FORBIDDEN");
  });

  it("rejects multipart abort when upload session does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/abort",
      payload: {
        uploadSessionId: "nonexistent-session-id",
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.errors[0]?.code).toBe("STORAGE_MULTIPART_INVALID");
  });
});
