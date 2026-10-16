import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, publications, publicationLocales, settings } from "@vibress/database";
import { eq, inArray, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  PublicationLocaleService,
} from "../src/application/publication-locale-service";
import { DrizzlePublicationLocaleRepository } from "../src/infrastructure/drizzle-publication-locale-repository";
import { DrizzleSettingRepository } from "../src/infrastructure/drizzle-setting-repository";

describe("Publication locale persistence and tenant isolation", () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 12);
  const pubA = "locale-alpha-" + suffix;
  const pubB = "locale-beta-" + suffix;
  const service = new PublicationLocaleService(
    new DrizzlePublicationLocaleRepository(),
    new DrizzleSettingRepository(),
  );
  const settingsRepo = new DrizzleSettingRepository();

  beforeAll(async () => {
    await db.insert(publications).values([
      { id: pubA, workspaceId: "ws_default", name: "Arabic Site", slug: pubA },
      { id: pubB, workspaceId: "ws_default", name: "French Site", slug: pubB, primaryLocale: "fr" },
    ]);
  });

  afterAll(async () => {
    await db.delete(publications).where(inArray(publications.id, [pubA, pubB]));
  });

  it("defaults each publication to one language without inserting Arabic", async () => {
    expect(await service.getConfiguration(pubA)).toMatchObject({
      primaryLocale: "en",
      enabledLocales: ["en"],
      isMultilingual: false,
    });
    expect(await service.getConfiguration(pubB)).toMatchObject({
      primaryLocale: "fr",
      enabledLocales: ["fr"],
      isMultilingual: false,
    });
    expect(await db.select().from(publicationLocales)
      .where(eq(publicationLocales.publicationId, pubA))).toEqual([]);
  });

  it("honors an explicit legacy Arabic site setting without mutating the publication", async () => {
    await settingsRepo.set({
      publicationId: pubA, namespace: "site", key: "locale",
      value: "ar", valueType: "string", classification: "public", updatedBy: null,
    });
    const result = await service.getConfiguration(pubA);
    expect(result).toMatchObject({
      primaryLocale: "ar",
      enabledLocales: ["ar"],
      needsReconciliation: true,
    });
    const [row] = await db.select().from(publications).where(eq(publications.id, pubA));
    expect(row?.primaryLocale).toBe("en");
  });

  it("atomically persists an Arabic primary and only explicitly selected secondary languages", async () => {
    const updated = await service.updateConfiguration(
      pubA,
      { primaryLocale: "ar", enabledLocales: ["ar", "fr-fr"] },
      null,
    );
    expect(updated).toMatchObject({
      primaryLocale: "ar", enabledLocales: ["ar", "fr-FR"],
      isMultilingual: true, needsReconciliation: false,
    });
    const [row] = await db.select().from(publications).where(eq(publications.id, pubA));
    expect(row?.primaryLocale).toBe("ar");
    const stored = await db.select().from(publicationLocales)
      .where(eq(publicationLocales.publicationId, pubA));
    expect(stored.map((r) => [r.locale, r.status, r.isDefault]).sort()).toEqual([
      ["ar", "active", true],
      ["fr-FR", "active", false],
    ].sort());
    expect((await settingsRepo.get("site", "locale", pubA))?.value).toBe("ar");
    expect(await service.getConfiguration(pubB)).toMatchObject({
      primaryLocale: "fr", enabledLocales: ["fr"],
    });
  });

  it("deactivation retains the previous locale row and excludes it from active configuration", async () => {
    const updated = await service.updateConfiguration(
      pubA, { primaryLocale: "ar", enabledLocales: ["ar"] }, null,
    );
    expect(updated.enabledLocales).toEqual(["ar"]);
    const [french] = await db.select().from(publicationLocales).where(and(
      eq(publicationLocales.publicationId, pubA),
      eq(publicationLocales.locale, "fr-FR"),
    ));
    expect(french?.status).toBe("inactive");
    expect(french?.isDefault).toBe(false);
    const [unaffected] = await db.select().from(publications).where(eq(publications.id, pubB));
    expect(unaffected?.primaryLocale).toBe("fr");
  });

  it("rejects attempts to mutate a foreign publication through an unknown ID", async () => {
    await expect(service.updateConfiguration(
      "does-not-exist", { primaryLocale: "en", enabledLocales: ["en"] }, null,
    )).rejects.toMatchObject({ code: "PUBLICATION_NOT_FOUND" });
    expect(await db.select().from(settings)
      .where(eq(settings.publicationId, pubB))).toEqual([]);
  });
});
