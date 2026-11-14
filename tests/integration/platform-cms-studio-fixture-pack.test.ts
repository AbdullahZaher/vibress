import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/main";
import { closeDbPool } from "@vibress/database";
import { closeRedisClient } from "@vibress/cache";
import { migrateDocument, type StudioDocument } from "@vibress/studio-core";
import { serializeStudioDocument } from "@vibress/studio-serializer";
import {
  loadCmsStudioFixturePack,
  type CmsStudioFixtureEntry,
} from "../fixtures/cms-studio/fixture-pack";
import {
  CMS_STUDIO_FIXTURE_PASSWORD,
  provisionCmsStudioFixturePack,
  teardownCmsStudioFixturePack,
  type ProvisionedCmsStudioFixture,
} from "../fixtures/cms-studio/provision";

interface SavedRecord {
  id: string;
  version: number;
  title: string;
  content?: unknown;
  contentJson?: unknown;
}

function documentOf(record: SavedRecord): StudioDocument {
  return migrateDocument(record.content ?? record.contentJson);
}

function pinnedEntry(key: string): CmsStudioFixtureEntry {
  const entry = loadCmsStudioFixturePack().content.find((candidate) => candidate.key === key);
  expect(entry).toBeDefined();
  return entry!;
}

describe("pinned two-publication CMS/Studio fixture pack", () => {
  const app = buildApp();
  let fixture: ProvisionedCmsStudioFixture;
  let primaryCookie = "";
  let secondaryCookie = "";

  function headers(cookie: string, publicationId: string) {
    return {
      cookie,
      origin: "http://localhost:7779",
      "x-publication-id": publicationId,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/v1/auth/login",
      payload: { email, password: CMS_STUDIO_FIXTURE_PASSWORD },
    });
    expect(response.statusCode, response.body).toBe(200);
    const header = response.headers["set-cookie"];
    return (Array.isArray(header) ? header[0]! : header!).split(";")[0]!;
  }

  async function read(publicationKey: "primary" | "secondary", entryKey: string) {
    const entry = pinnedEntry(entryKey);
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/v1/${entry.kind}s/${fixture.content[entryKey]!.id}`,
      headers: headers(
        publicationKey === "primary" ? primaryCookie : secondaryCookie,
        fixture.publications[publicationKey].id,
      ),
    });
    return { entry, response };
  }

  beforeAll(async () => {
    await app.ready();
    fixture = await provisionCmsStudioFixturePack(randomUUID().slice(0, 8));
    primaryCookie = await login(fixture.staff.primary.email);
    secondaryCookie = await login(fixture.staff.secondary.email);
  });

  afterAll(async () => {
    try {
      if (fixture) await teardownCmsStudioFixturePack(fixture);
    } finally {
      await app.close();
      await closeRedisClient();
      await closeDbPool();
    }
  });

  it("serves each publication's pinned Studio document unchanged", async () => {
    for (const [publicationKey, entryKey] of [
      ["primary", "primary-post"],
      ["secondary", "secondary-post"],
      ["primary", "primary-page"],
    ] as const) {
      const { entry, response } = await read(publicationKey, entryKey);
      expect(response.statusCode, response.body).toBe(200);
      const record = (response.json() as Record<string, SavedRecord>)[entry.kind]!;
      expect(record.title).toBe(entry.title);
      const persisted = documentOf(record);
      expect(persisted).toEqual(entry.document);
      expect(serializeStudioDocument(persisted.root, undefined, persisted)).toEqual(
        entry.document,
      );
      expect(JSON.stringify(persisted)).not.toContain("react-studio-card");
    }
    const primaryPost = documentOf(
      (await read("primary", "primary-post")).response.json().post,
    );
    expect(JSON.stringify(primaryPost)).toContain('"type":"studio-card"');
    const secondaryPost = documentOf(
      (await read("secondary", "secondary-post")).response.json().post,
    );
    expect(secondaryPost.root.direction).toBe("rtl");
  });

  it("never discloses or authorizes another publication's content", async () => {
    const primaryHeaders = headers(primaryCookie, fixture.publications.primary.id);
    const fakeId = randomUUID();
    const fake = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${fakeId}`,
      headers: primaryHeaders,
    });
    const cross = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${fixture.content["secondary-post"]!.id}`,
      headers: primaryHeaders,
    });
    expect(fake.statusCode).toBe(404);
    expect(cross.statusCode).toBe(404);
    const withoutRequestId = (body: {
      errors: Array<{ requestId: unknown; [key: string]: unknown }>;
    }) => ({
      ...body,
      errors: body.errors.map(({ requestId: _requestId, ...rest }) => rest),
    });
    expect(withoutRequestId(cross.json())).toEqual(withoutRequestId(fake.json()));

    const denied = await app.inject({
      method: "GET",
      url: `/api/admin/v1/posts/${fixture.content["primary-post"]!.id}`,
      headers: headers(primaryCookie, fixture.publications.secondary.id),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().errors[0].code).toBe("PUBLICATION_ACCESS_DENIED");

    const secondary = await read("secondary", "secondary-post");
    const version = (secondary.response.json() as Record<string, SavedRecord>).post!.version;
    const write = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/posts/${fixture.content["secondary-post"]!.id}`,
      headers: primaryHeaders,
      payload: {
        content: pinnedEntry("primary-post").document,
        expectedVersion: version,
      },
    });
    expect(write.statusCode).toBe(404);

    const after = await read("secondary", "secondary-post");
    expect(documentOf(after.response.json().post)).toEqual(
      pinnedEntry("secondary-post").document,
    );
  });

  it("round-trips pinned content through the Studio save path and restores it", async () => {
    const { entry, response } = await read("primary", "primary-post");
    const record = (response.json() as Record<string, SavedRecord>).post!;
    const pinned = documentOf(record);
    expect(pinned).toEqual(entry.document);

    const edited: StudioDocument = {
      ...pinned,
      root: {
        ...pinned.root,
        children: [
          ...pinned.root.children,
          {
            type: "paragraph",
            direction: null,
            format: "",
            indent: 0,
            version: 1,
            children: [
              {
                type: "text",
                text: "Edited by the pinned fixture round-trip.",
                format: 0,
                detail: 0,
                mode: "normal",
                style: "",
                version: 1,
              },
            ],
          },
        ],
      },
    };
    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/posts/${fixture.content["primary-post"]!.id}`,
      headers: headers(primaryCookie, fixture.publications.primary.id),
      payload: { content: edited, expectedVersion: record.version },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const saved = (updated.json() as { post: SavedRecord }).post;
    const reloaded = documentOf(saved);
    expect(reloaded).toEqual(edited);
    expect(serializeStudioDocument(reloaded.root, undefined, reloaded)).toEqual(edited);

    const restored = await app.inject({
      method: "PUT",
      url: `/api/admin/v1/posts/${fixture.content["primary-post"]!.id}`,
      headers: headers(primaryCookie, fixture.publications.primary.id),
      payload: { content: entry.document, expectedVersion: saved.version },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const verify = await read("primary", "primary-post");
    expect(documentOf(verify.response.json().post)).toEqual(entry.document);
    expect(() => loadCmsStudioFixturePack()).not.toThrow();
  });
});
