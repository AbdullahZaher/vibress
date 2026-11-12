import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import Fastify, { FastifyInstance } from "fastify";
import { storageRoutes } from "../routes/storage";
import { DrizzleStorageRepository } from "@vibress/storage-domain";
import { getDb, users } from "@vibress/database";
import {
  defaultStorageRegistry,
  StorageCapabilities,
  StorageProvider,
} from "@vibress/storage-core";
import { AssetType } from "@vibress/media";

const repo = new DrizzleStorageRepository();

// 1x1 transparent PNG — satisfies magic-byte detection and dimension parsing.
const PNG_HEAD = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const FAKE_CAPABILITIES: StorageCapabilities = {
  signedUrls: false,
  directUpload: true,
  multipartUpload: true,
  privateObjects: true,
  publicObjects: false,
};

class ReadableFakeProvider implements StorageProvider {
  readonly name = "fake-readable";
  headSize = 0;
  multipartSize = 0;
  objectHead: Buffer | null = null;
  deleted: string[] = [];

  getCapabilities(): StorageCapabilities {
    return FAKE_CAPABILITIES;
  }
  async put(input: { key: string; body: Buffer | Uint8Array }) {
    return {
      key: input.key,
      url: `http://fake/${input.key}`,
      size: input.body.length,
    };
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }
  async exists(): Promise<boolean> {
    return true;
  }
  async getUrl(key: string): Promise<string> {
    return `http://fake/${key}`;
  }
  async headObject() {
    return { size: this.headSize, contentType: "image/png", etag: "etag" };
  }
  async getObjectBuffer(): Promise<Buffer | null> {
    return this.objectHead;
  }
  async createSignedUploadUrl(input: { key: string }) {
    return {
      uploadUrl: `http://fake/upload/${input.key}`,
      key: input.key,
      expiresAt: new Date(Date.now() + 600000),
    };
  }
  async createMultipartUpload(input: { key: string }) {
    return { uploadId: "mp-fake", key: input.key };
  }
  async getSignedPartUrl(input: { partNumber: number }) {
    return { partNumber: input.partNumber, url: "http://fake/part" };
  }
  async completeMultipartUpload(input: { key: string }) {
    return {
      key: input.key,
      url: `http://fake/${input.key}`,
      size: this.multipartSize,
      contentType: "image/png",
      etag: "etag",
    };
  }
  async abortMultipartUpload(): Promise<void> {}
}

class HeadOnlyFakeProvider implements StorageProvider {
  readonly name = "fake-head-only";
  headSize = 500;
  deleted: string[] = [];

  getCapabilities(): StorageCapabilities {
    return FAKE_CAPABILITIES;
  }
  async put(input: { key: string; body: Buffer | Uint8Array }) {
    return {
      key: input.key,
      url: `http://fake/${input.key}`,
      size: input.body.length,
    };
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }
  async exists(): Promise<boolean> {
    return true;
  }
  async getUrl(key: string): Promise<string> {
    return `http://fake/${key}`;
  }
  async headObject() {
    return { size: this.headSize, contentType: "image/png", etag: "etag" };
  }
  async createSignedUploadUrl(input: { key: string }) {
    return {
      uploadUrl: `http://fake/upload/${input.key}`,
      key: input.key,
      expiresAt: new Date(Date.now() + 600000),
    };
  }
}

describe("API Security — Media Uploads & Direct Upload Hardening", () => {
  let app: FastifyInstance;
  const currentUserId = "test-user-1";

  beforeAll(async () => {
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
      (req as any).publicationContext = {
        publicationId: "pub_default",
        workspaceId: "ws_default",
        actorId: currentUserId,
        actorType: "staff",
        role: "admin",
        isSystemOperation: false,
      };
    });

    await app.register(storageRoutes);
    await app.ready();
  });

  beforeEach(async () => {
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

describe("API Security — F-009 upload completion bounds and signature verification", () => {
  let app: FastifyInstance;
  const currentUserId = "test-user-1";
  const readable = new ReadableFakeProvider();
  const headOnly = new HeadOnlyFakeProvider();

  const storageKey = (name: string) =>
    `media/${crypto.randomUUID()}/${name}`;

  async function createDirectSession(opts: {
    expectedSize: number;
    assetType: AssetType;
    filename?: string;
    declaredMime?: string;
  }) {
    return repo.createUploadSession({
      actorId: currentUserId,
      storageKey: storageKey(opts.filename ?? "photo.png"),
      originalFilename: opts.filename ?? "photo.png",
      declaredMime: opts.declaredMime ?? "image/png",
      expectedSize: opts.expectedSize,
      assetType: opts.assetType,
      expiresAt: new Date(Date.now() + 600000),
    });
  }

  async function createMultipartSession(opts: {
    expectedSize: number;
    assetType: AssetType;
    filename?: string;
    declaredMime?: string;
  }) {
    return repo.createUploadSession({
      actorId: currentUserId,
      storageKey: storageKey(opts.filename ?? "photo.png"),
      originalFilename: opts.filename ?? "photo.png",
      declaredMime: opts.declaredMime ?? "image/png",
      expectedSize: opts.expectedSize,
      assetType: opts.assetType,
      expiresAt: new Date(Date.now() + 600000),
      multipartUploadId: "mp-fake-f009",
    });
  }

  beforeAll(async () => {
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
      (req as any).publicationContext = {
        publicationId: "pub_default",
        workspaceId: "ws_default",
        actorId: currentUserId,
        actorType: "staff",
        role: "admin",
        isSystemOperation: false,
      };
    });
    await app.register(storageRoutes);
    await app.ready();

    defaultStorageRegistry.register(readable);
    defaultStorageRegistry.register(headOnly);
  });

  beforeEach(() => {
    readable.headSize = 0;
    readable.multipartSize = 0;
    readable.objectHead = null;
    readable.deleted = [];
    headOnly.deleted = [];
    defaultStorageRegistry.setActiveProvider(readable.name);
  });

  afterAll(async () => {
    defaultStorageRegistry.setActiveProvider("local");
    defaultStorageRegistry.unregister(readable.name);
    defaultStorageRegistry.unregister(headOnly.name);
    await app.close();
  });

  it("rejects a direct upload larger than the declared size", async () => {
    readable.headSize = 5000;
    readable.objectHead = PNG_HEAD;
    const session = await createDirectSession({
      expectedSize: 1000,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("MEDIA_TOO_LARGE");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
    expect(readable.deleted).toContain(session.storageKey);
  });

  it("rejects a direct upload above the per-asset-type ceiling", async () => {
    readable.headSize = 25 * 1024 * 1024;
    readable.objectHead = PNG_HEAD;
    const session = await createDirectSession({
      expectedSize: 500 * 1024 * 1024,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("MEDIA_TOO_LARGE");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
  });

  it("rejects a direct upload whose bytes do not match the declared MIME", async () => {
    readable.headSize = 500;
    readable.objectHead = Buffer.from("#!/bin/sh\necho pwned\n");
    const session = await createDirectSession({
      expectedSize: 1000,
      assetType: "image",
      filename: "innocent.png",
      declaredMime: "image/png",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("MEDIA_MIME_MISMATCH");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
    expect(readable.deleted).toContain(session.storageKey);
  });

  it("fails closed when the provider cannot read the object for verification", async () => {
    defaultStorageRegistry.setActiveProvider(headOnly.name);
    const session = await createDirectSession({
      expectedSize: 1000,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("STORAGE_SIGNATURE_UNSUPPORTED");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
    expect(headOnly.deleted).toContain(session.storageKey);
  });

  it("registers a verified direct upload within bounds", async () => {
    readable.headSize = 500;
    readable.objectHead = PNG_HEAD;
    const session = await createDirectSession({
      expectedSize: 1000,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/direct/complete",
      payload: { uploadSessionId: session.id },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().media.sizeBytes).toBe(500);
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "verified",
    );
    expect(readable.deleted).not.toContain(session.storageKey);
  });

  it("rejects a multipart upload larger than the declared size", async () => {
    readable.multipartSize = 5000;
    readable.objectHead = PNG_HEAD;
    const session = await createMultipartSession({
      expectedSize: 1000,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/complete",
      payload: {
        uploadSessionId: session.id,
        parts: [{ partNumber: 1, etag: "tag-1" }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("MEDIA_TOO_LARGE");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
    expect(readable.deleted).toContain(session.storageKey);
  });

  it("rejects a multipart upload whose bytes do not match the declared MIME", async () => {
    readable.multipartSize = 500;
    readable.objectHead = Buffer.from("#!/bin/sh\necho pwned\n");
    const session = await createMultipartSession({
      expectedSize: 1000,
      assetType: "image",
      filename: "innocent.png",
      declaredMime: "image/png",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/complete",
      payload: {
        uploadSessionId: session.id,
        parts: [{ partNumber: 1, etag: "tag-1" }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].code).toBe("MEDIA_MIME_MISMATCH");
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "failed",
    );
  });

  it("registers a verified multipart upload within bounds", async () => {
    readable.multipartSize = 500;
    readable.objectHead = PNG_HEAD;
    const session = await createMultipartSession({
      expectedSize: 1000,
      assetType: "image",
    });

    const res = await app.inject({
      method: "POST",
      url: "/media/uploads/multipart/complete",
      payload: {
        uploadSessionId: session.id,
        parts: [{ partNumber: 1, etag: "tag-1" }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().media.sizeBytes).toBe(500);
    expect((await repo.findUploadSessionById(session.id))?.state).toBe(
      "verified",
    );
    expect(readable.deleted).not.toContain(session.storageKey);
  });
});
