import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, mediaAssets, publications, settings } from "@vibress/database";
import { hashPassword } from "@vibress/security";
import { buildApp } from "../main";

describe("public local media publication ownership", () => {
  const suffix = randomUUID();
  const privateId = `private-${suffix}`;
  const publicId = `public-${suffix}`;
  const privateHost = `${privateId}.example.test`;
  const publicHost = `${publicId}.example.test`;
  const directory = `media/${suffix}`;
  const storageKey = `${directory}/private.jpg`;
  const aliasKey = `${directory}/alias.jpg`;
  const assetId = randomUUID();
  const assetUrl = `/content/media/${storageKey}`;
  const bytes = Buffer.from("Private publication asset");
  const password = "Temporary media fixture password";
  let app: ReturnType<typeof buildApp> | undefined;
  let storageRoot: string | undefined;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "vibress-media-scope-"));
    vi.stubEnv("STORAGE_LOCAL_ROOT", storageRoot);
    await mkdir(join(storageRoot, directory), { recursive: true });
    await writeFile(join(storageRoot, storageKey), bytes);
    await writeFile(join(storageRoot, "media/legacy.jpg"), "Legacy default site asset");
    await symlink(join(storageRoot, storageKey), join(storageRoot, aliasKey));

    const db = getDb();
    await db.insert(publications).values([
      { id: privateId, workspaceId: "ws_default", name: "Private media", slug: privateId, domain: privateHost },
      { id: publicId, workspaceId: "ws_default", name: "Public media", slug: publicId, domain: publicHost },
    ]);
    await db.insert(settings).values([
      {
        id: randomUUID(), publicationId: privateId, namespace: "security", key: "isPrivate",
        value: true, valueType: "boolean", classification: "public",
      },
      {
        id: randomUUID(), publicationId: privateId, namespace: "security", key: "passwordHash",
        value: await hashPassword(password), valueType: "string", classification: "secret",
      },
    ]);
    await db.insert(mediaAssets).values({
      id: assetId, publicationId: privateId, storageProvider: "local", storageKey,
      originalFilename: "private.jpg", displayName: "Private media fixture", mimeType: "image/jpeg",
      extension: "jpg", sizeBytes: bytes.length, checksum: suffix, assetType: "image",
    });
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await getDb().delete(publications).where(inArray(publications.id, [privateId, publicId]));
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function server() {
    if (!app) throw new Error("Media test app was not initialized");
    return app;
  }

  it("rejects anonymous access and alternate publication hostnames", async () => {
    const anonymous = await server().inject({ url: assetUrl, headers: { host: privateHost } });
    expect(anonymous.statusCode).toBe(403);
    for (const host of [publicHost, "localhost"]) {
      for (const url of [assetUrl, `/content/media/${aliasKey}`]) {
        const wrongPublication = await server().inject({ url, headers: { host } });
        expect(wrongPublication.statusCode).toBe(404);
      }
    }
  });

  it("serves authorized ranges without shared caching and denies retained deleted bytes", async () => {
    const verify = await server().inject({
      method: "POST", url: "/api/content/v1/verify-site-password", headers: { host: privateHost },
      payload: { password },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ valid: true, private: true });
    const cookie = verify.cookies.find(({ name }) => name === "vb_site_auth");
    expect(cookie).toBeDefined();
    if (!cookie) throw new Error("Private site login did not return a cookie");
    const headers = { host: privateHost, cookie: `${cookie.name}=${cookie.value}` };
    const served = await server().inject({ url: assetUrl, headers });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload).toEqual(bytes);
    expect(served.headers["cache-control"]).toBe("private, no-store");
    const range = await server().inject({ url: assetUrl, headers: { ...headers, range: "bytes=0-6" } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(bytes.subarray(0, 7));
    expect(range.headers["cache-control"]).toBe("private, no-store");

    await getDb().update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, assetId));
    expect((await server().inject({ url: assetUrl, headers })).statusCode).toBe(404);
    expect((await server().inject({ url: assetUrl, headers: { host: "localhost" } })).statusCode).toBe(404);
  });

  it("keeps pre-catalog files available on the original publication only", async () => {
    const url = "/content/media/media/legacy.jpg";
    const legacy = await server().inject({ url, headers: { host: "localhost" } });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.headers["cache-control"]).toBe("public, max-age=3600");
    const unrelated = await server().inject({ url, headers: { host: publicHost } });
    expect(unrelated.statusCode).toBe(404);
  });
});
