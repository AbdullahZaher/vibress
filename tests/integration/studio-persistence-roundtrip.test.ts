import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/main";
import { closeDbPool } from "@vibress/database";
import { closeRedisClient } from "@vibress/cache";
import {
  createDefaultStudioDocument,
  migrateDocument,
  type StudioDocument,
} from "@vibress/studio-core";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import { EditorialAutosaveGenerations } from "../../apps/admin/src/lib/editorial-autosave-generations";

interface SavedRecord {
  id: string;
  version: number;
  content?: unknown;
  contentJson?: unknown;
}
function content(record: SavedRecord): StudioDocument {
  return migrateDocument(record.content ?? record.contentJson);
}
function draft(text: string) {
  const doc = createDefaultStudioDocument(text);
  return {
    ...doc,
    publicationMetadata: { status: "review" },
    editor: { ...doc.editor, extension: { retain: true } },
  };
}

describe("real host HTTP and PostgreSQL Studio persistence", () => {
  const app = buildApp();
  let cookie: string;
  let authorId: string;
  beforeAll(async () => {
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "OwnerPass123!",
      },
    });
    expect(login.statusCode).toBe(200);
    authorId = (login.json() as { user: { id: string } }).user.id;
    const header = login.headers["set-cookie"];
    cookie = (Array.isArray(header) ? header[0]! : header!).split(";")[0]!;
  });
  afterAll(async () => {
    await app.close();
    await closeRedisClient();
    await closeDbPool();
  });

  it.each(["posts", "pages"] as const)(
    "keeps newer %s draft dirty, persists B, reloads exactly, and rejects a stale revision",
    async (kind) => {
      const key = kind === "posts" ? "post" : "page";
      const initial = draft("Initial مسودة English");
      const created = await app.inject({
        method: "POST",
        url: `/api/admin/v1/${kind}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: {
          title: "Studio integrity",
          slug: `studio-qa-${randomUUID()}`,
          content: initial,
          primaryAuthorId: authorId,
          authorIds: [authorId],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const record = (created.json() as Record<typeof key, SavedRecord>)[key];
      const generations = new EditorialAutosaveGenerations();
      const a = draft("Draft A مسودة");
      const b = draft("Draft B مرحبا English");
      generations.markEdited();
      const ticketA = generations.beginSave();
      const responseA = app.inject({
        method: "PUT",
        url: `/api/admin/v1/${kind}/${record.id}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: { content: a, expectedVersion: record.version },
      });
      generations.markEdited(); // B is edited while A is in flight.
      const acknowledgedA = await responseA;
      expect(acknowledgedA.statusCode, acknowledgedA.body).toBe(200);
      const savedA = (acknowledgedA.json() as Record<typeof key, SavedRecord>)[
        key
      ];
      expect(generations.acknowledge(ticketA)).toEqual({
        latestRequest: true,
        latestEdit: false,
      });
      const ticketB = generations.beginSave();
      const responseB = await app.inject({
        method: "PUT",
        url: `/api/admin/v1/${kind}/${record.id}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: { content: b, expectedVersion: savedA.version },
      });
      expect(responseB.statusCode, responseB.body).toBe(200);
      expect(generations.isCurrent(ticketB)).toBe(true);
      const stale = await app.inject({
        method: "PUT",
        url: `/api/admin/v1/${kind}/${record.id}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: { content: a, expectedVersion: savedA.version },
      });
      expect(stale.statusCode).toBe(409);
      const reload = await app.inject({
        method: "GET",
        url: `/api/admin/v1/${kind}/${record.id}`,
        headers: { cookie, origin: "http://localhost:7779" },
      });
      expect(reload.statusCode).toBe(200);
      const persisted = content(
        (reload.json() as Record<typeof key, SavedRecord>)[key],
      );
      expect(persisted).toEqual(b);
      expect(
        serializeStudioDocument(persisted.root, undefined, persisted),
      ).toEqual(b);
    },
  );

  it.each(["posts", "pages"] as const)(
    "loads historical %s content without mutation and keeps record identities separate",
    async (kind) => {
      const key = kind === "posts" ? "post" : "page";
      const original = draft("Historical عربي English");
      const { type: _type, ...legacyRoot } = original.root;
      const legacy = { version: 1, root: legacyRoot };
      const created = await app.inject({
        method: "POST",
        url: `/api/admin/v1/${kind}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: {
          title: "Historical content",
          slug: `studio-legacy-${randomUUID()}`,
          content: legacy,
          primaryAuthorId: authorId,
          authorIds: [authorId],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const first = (created.json() as Record<typeof key, SavedRecord>)[key];
      const second = await app.inject({
        method: "POST",
        url: `/api/admin/v1/${kind}`,
        headers: { cookie, origin: "http://localhost:7779" },
        payload: {
          title: "Independent",
          slug: `studio-other-${randomUUID()}`,
          content: draft("Independent"),
          primaryAuthorId: authorId,
          authorIds: [authorId],
        },
      });
      expect(second.statusCode, second.body).toBe(201);
      const next = (second.json() as Record<typeof key, SavedRecord>)[key];
      expect(next.id).not.toBe(first.id);
      const reload = await app.inject({
        method: "GET",
        url: `/api/admin/v1/${kind}/${first.id}`,
        headers: { cookie, origin: "http://localhost:7779" },
      });
      expect(
        content((reload.json() as Record<typeof key, SavedRecord>)[key]).root,
      ).toEqual(original.root);
      expect(legacy.root).not.toHaveProperty("type");
    },
  );
});
