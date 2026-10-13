import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleSettingRepository } from "../src/infrastructure/drizzle-setting-repository";

describe("Publication-owned settings persistence", () => {
  const db = getDb();
  const repo = new DrizzleSettingRepository();
  const suffix = randomUUID().slice(0, 12);
  const publicationA = `setting-alpha-${suffix}`;
  const publicationB = `setting-beta-${suffix}`;

  beforeAll(async () => {
    await db.insert(publications).values([
      {
        id: publicationA,
        workspaceId: "ws_default",
        name: "Settings Alpha",
        slug: publicationA,
        primaryLocale: "en",
      },
      {
        id: publicationB,
        workspaceId: "ws_default",
        name: "Settings Beta",
        slug: publicationB,
        primaryLocale: "en",
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(publications)
      .where(inArray(publications.id, [publicationA, publicationB]));
  });

  it("keeps identical namespace/key combinations isolated", async () => {
    const makeRecord = (value: string, publicationId: string) => ({
      namespace: "site",
      key: "title",
      value,
      valueType: "string" as const,
      classification: "public" as const,
      updatedBy: null,
      publicationId,
    });

    await repo.set(makeRecord("Alpha", publicationA));
    await repo.set(makeRecord("Beta", publicationB));
    expect((await repo.get("site", "title", publicationA))?.value).toBe("Alpha");
    expect((await repo.get("site", "title", publicationB))?.value).toBe("Beta");
    expect(await repo.get("site", "title")).toBeNull();

    await repo.set(makeRecord("Alpha updated", publicationA));
    expect((await repo.get("site", "title", publicationA))?.value).toBe("Alpha updated");
    expect((await repo.get("site", "title", publicationB))?.value).toBe("Beta");

    const alpha = await repo.getMany("site", publicationA);
    expect(alpha).toHaveLength(1);
    expect(alpha[0]?.value).toBe("Alpha updated");
  });

  it("deletes settings only within the authoritative publication", async () => {
    await repo.delete("site", "title", publicationA);
    expect(await repo.get("site", "title", publicationA)).toBeNull();
    expect((await repo.get("site", "title", publicationB))?.value).toBe("Beta");
  });
});
