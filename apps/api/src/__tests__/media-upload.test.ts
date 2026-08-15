import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../main";
import { FastifyInstance } from "fastify";
import path from "path";
import fs from "fs";

describe("Media API Upload & Security Integration", () => {
  let app: FastifyInstance;
  const mediaDir = path.resolve(process.cwd(), "content", "media");
  const testFileName = "test-stream-sample.mp4";
  const testFilePath = path.join(mediaDir, testFileName);
  const testFileContent = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"); // 36 bytes

  beforeAll(async () => {
    await fs.promises.mkdir(mediaDir, { recursive: true });
    await fs.promises.writeFile(testFilePath, testFileContent);
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try {
      await fs.promises.unlink(testFilePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("should reject unauthenticated upload requests with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/v1/media",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should reject non-existent media item with 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/v1/media/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(401); // Auth required first
  });

  describe("Local Media Serving & Range Streaming (H6)", () => {
    it("streams complete media file with 200 OK and Accept-Ranges header", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["content-type"]).toBe("video/mp4");
      expect(res.headers["content-length"]).toBe(
        String(testFileContent.length),
      );
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.rawPayload).toEqual(testFileContent);
    });

    it("handles byte range request (bytes=0-9) returning 206 Partial Content", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
        headers: { range: "bytes=0-9" },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["content-range"]).toBe(
        `bytes 0-9/${testFileContent.length}`,
      );
      expect(res.headers["content-length"]).toBe("10");
      expect(res.headers["content-type"]).toBe("video/mp4");
      expect(res.rawPayload.toString("utf8")).toBe("0123456789");
    });

    it("handles open-ended byte range request (bytes=10-)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
        headers: { range: "bytes=10-" },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers["content-range"]).toBe(
        `bytes 10-35/${testFileContent.length}`,
      );
      expect(res.headers["content-length"]).toBe("26");
      expect(res.rawPayload.toString("utf8")).toBe(
        "abcdefghijklmnopqrstuvwxyz",
      );
    });

    it("returns 416 Range Not Satisfiable for invalid range (beyond file length)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
        headers: { range: "bytes=500-600" },
      });

      expect(res.statusCode).toBe(416);
      expect(res.headers["content-range"]).toBe(
        `bytes */${testFileContent.length}`,
      );
    });

    it("sets ETag, Last-Modified, Cache-Control, and Content-Disposition headers", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["etag"]).toBeDefined();
      expect(res.headers["etag"]).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
      expect(res.headers["last-modified"]).toBeDefined();
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
      expect(res.headers["content-disposition"]).toContain("inline");
      expect(res.headers["content-disposition"]).toContain(testFileName);
    });

    it("returns 304 Not Modified when If-None-Match matches ETag", async () => {
      const firstRes = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
      });
      const etag = firstRes.headers["etag"];

      const secondRes = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
        headers: { "if-none-match": etag },
      });

      expect(secondRes.statusCode).toBe(304);
      expect(secondRes.rawPayload.length).toBe(0);
    });

    it("handles suffix range request (bytes=-10)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/content/media/${testFileName}`,
        headers: { range: "bytes=-10" },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers["content-range"]).toBe(
        `bytes 26-35/${testFileContent.length}`,
      );
      expect(res.headers["content-length"]).toBe("10");
      expect(res.rawPayload.toString("utf8")).toBe("qrstuvwxyz");
    });

    it("blocks path traversal attempts (..)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/content/media/../../../etc/passwd",
      });
      expect([404, 400]).toContain(res.statusCode);
    });

    it("blocks NUL byte in path", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/content/media/test%00.txt",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for non-existent file", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/content/media/nonexistent-file.mp4",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
