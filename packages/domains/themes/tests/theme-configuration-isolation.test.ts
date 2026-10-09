import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleThemeConfigurationRepository } from "../src/infrastructure/drizzle-theme-configuration-repository";
import { DrizzleInstalledThemeRepository } from "../src/infrastructure/drizzle-installed-theme-repository";

describe("Theme activation and settings publication isolation", () => {
  const db = getDb();
  const activeRepo = new DrizzleThemeConfigurationRepository();
  const installedRepo = new DrizzleInstalledThemeRepository();
  const suffix = randomUUID().slice(0, 12);
  const publicationA = `theme-iso-a-${suffix}`;
  const publicationB = `theme-iso-b-${suffix}`;
  const sharedThemeId = `theme-iso-shared-${suffix}`;

  beforeAll(async () => {
    await db.insert(publications).values([
      {
        id: publicationA,
        workspaceId: "ws_default",
        name: "Theme Isolation A",
        slug: publicationA,
        primaryLocale: "en",
      },
      {
        id: publicationB,
        workspaceId: "ws_default",
        name: "Theme Isolation B",
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

  const configuration = (themeId: string, color: string) => ({
    id: "active",
    themeId,
    themeVersion: "1.0.0",
    settings: { color },
    settingsSchemaVersion: 1,
    activatedBy: null,
    activatedAt: new Date(),
    updatedAt: new Date(),
  });

  it("keeps active theme and settings independent across publications", async () => {
    await activeRepo.setActive(configuration("vibress-default", "red"), publicationA);
    await activeRepo.setActive(configuration("vibress-minimal", "blue"), publicationB);

    expect((await activeRepo.getActive(publicationA))?.themeId).toBe("vibress-default");
    expect((await activeRepo.getActive(publicationB))?.themeId).toBe("vibress-minimal");
    expect((await activeRepo.getActive(publicationA))?.settings).toEqual({ color: "red" });
    expect((await activeRepo.getActive(publicationB))?.settings).toEqual({ color: "blue" });

    await activeRepo.setActive(configuration("vibress-minimal", "green"), publicationA);
    expect((await activeRepo.getActive(publicationA))?.settings).toEqual({ color: "green" });
    expect((await activeRepo.getActive(publicationB))?.settings).toEqual({ color: "blue" });
  });

  it("allows identical theme IDs with different saved settings per publication", async () => {
    await installedRepo.saveThemeSettings(sharedThemeId, { accentColor: "#111111" }, publicationA);
    await installedRepo.saveThemeSettings(sharedThemeId, { accentColor: "#222222" }, publicationB);

    expect(await installedRepo.getThemeSettings(sharedThemeId, publicationA)).toEqual({
      accentColor: "#111111",
    });
    expect(await installedRepo.getThemeSettings(sharedThemeId, publicationB)).toEqual({
      accentColor: "#222222",
    });
  });

  it("does not remove another publication's settings when deleting a theme", async () => {
    await installedRepo.delete(sharedThemeId, publicationA);
    expect(await installedRepo.getThemeSettings(sharedThemeId, publicationA)).toBeNull();
    expect(await installedRepo.getThemeSettings(sharedThemeId, publicationB)).toEqual({
      accentColor: "#222222",
    });
  });
});
