import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, installedThemes, publications } from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleInstalledThemeRepository } from "../src/infrastructure/drizzle-installed-theme-repository.js";

describe("Themes Multi-Publication Isolation", () => {
  const db = getDb();
  const repo = new DrizzleInstalledThemeRepository();

  const runSuffix = Math.random().toString(36).substring(2, 8);
  const sharedThemeId = `shared-theme-${runSuffix}`;
  const sharedVersion = "1.0.0";
  let alphaThemeDbId: string;
  let betaThemeDbId: string;

  beforeAll(async () => {
    await db
      .insert(publications)
      .values([
        {
          id: "pub_alpha",
          workspaceId: "ws_default",
          name: "Alpha Pub",
          slug: "alpha",
          primaryLocale: "en",
        },
        {
          id: "pub_beta",
          workspaceId: "ws_default",
          name: "Beta Pub",
          slug: "beta",
          primaryLocale: "en",
        },
      ])
      .onConflictDoNothing();

    // Create theme in pub_alpha
    const alphaTheme = await repo.create(
      {
        id: randomUUID(),
        publicationId: "pub_alpha",
        themeId: sharedThemeId,
        name: `Alpha Theme ${runSuffix}`,
        version: sharedVersion,
        themeApiVersion: 1,
        manifest: { id: sharedThemeId, name: `Alpha Theme ${runSuffix}`, version: sharedVersion, themeApi: 1 },
        settingsSchema: {},
        storagePath: `/themes/pub_alpha/${sharedThemeId}/${sharedVersion}`,
        status: "installed",
        isBuiltIn: false,
        installedAt: new Date(),
        updatedAt: new Date(),
      },
      "pub_alpha",
    );
    alphaThemeDbId = alphaTheme.id;

    // Create theme in pub_beta with IDENTICAL themeId and version
    const betaTheme = await repo.create(
      {
        id: randomUUID(),
        publicationId: "pub_beta",
        themeId: sharedThemeId,
        name: `Beta Theme ${runSuffix}`,
        version: sharedVersion,
        themeApiVersion: 1,
        manifest: { id: sharedThemeId, name: `Beta Theme ${runSuffix}`, version: sharedVersion, themeApi: 1 },
        settingsSchema: {},
        storagePath: `/themes/pub_beta/${sharedThemeId}/${sharedVersion}`,
        status: "installed",
        isBuiltIn: false,
        installedAt: new Date(),
        updatedAt: new Date(),
      },
      "pub_beta",
    );
    betaThemeDbId = betaTheme.id;
  });

  afterAll(async () => {
    await db
      .delete(installedThemes)
      .where(inArray(installedThemes.id, [alphaThemeDbId, betaThemeDbId]));
  });

  it("coexists with identical themeId and version across pub_alpha and pub_beta", () => {
    expect(alphaThemeDbId).toBeDefined();
    expect(betaThemeDbId).toBeDefined();
    expect(alphaThemeDbId).not.toBe(betaThemeDbId);
  });

  it("strictly scopes listAll to the requested publication", async () => {
    const alphaList = await repo.listAll("pub_alpha");
    const betaList = await repo.listAll("pub_beta");

    const alphaIds = alphaList.map((t) => t.id);
    const betaIds = betaList.map((t) => t.id);

    expect(alphaIds).toContain(alphaThemeDbId);
    expect(alphaIds).not.toContain(betaThemeDbId);

    expect(betaIds).toContain(betaThemeDbId);
    expect(betaIds).not.toContain(alphaThemeDbId);
  });

  it("prevents cross-publication read via findById", async () => {
    const fromAlpha = await repo.findById(alphaThemeDbId, "pub_alpha");
    expect(fromAlpha).not.toBeNull();
    expect(fromAlpha?.name).toBe(`Alpha Theme ${runSuffix}`);

    // Adversarial: reading alpha with pub_beta
    const crossRead = await repo.findById(alphaThemeDbId, "pub_beta");
    expect(crossRead).toBeNull();
  });

  it("prevents cross-publication read via findByThemeIdAndVersion", async () => {
    const alphaMatch = await repo.findByThemeIdAndVersion(sharedThemeId, sharedVersion, "pub_alpha");
    const betaMatch = await repo.findByThemeIdAndVersion(sharedThemeId, sharedVersion, "pub_beta");

    expect(alphaMatch?.id).toBe(alphaThemeDbId);
    expect(betaMatch?.id).toBe(betaThemeDbId);
  });

  it("rejects cross-publication deletion", async () => {
    // Adversarial: pub_beta tries to delete alpha's theme
    await repo.delete(sharedThemeId, "pub_beta");

    // Alpha theme still exists intact
    const stillThere = await repo.findById(alphaThemeDbId, "pub_alpha");
    expect(stillThere).not.toBeNull();
  });
});
