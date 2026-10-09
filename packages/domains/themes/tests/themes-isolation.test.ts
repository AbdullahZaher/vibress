import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb,
  installedThemes,
  themeConfigurations,
  themeSettings,
  publications,
} from "@vibress/database";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DrizzleInstalledThemeRepository } from "../src/infrastructure/drizzle-installed-theme-repository.js";
import { DrizzleThemeConfigurationRepository } from "../src/infrastructure/drizzle-theme-configuration-repository.js";

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

describe("Theme active state and settings are publication-isolated", () => {
  const db = getDb();
  const installedRepo = new DrizzleInstalledThemeRepository();
  const activeRepo = new DrizzleThemeConfigurationRepository();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const alpha = `pub_theme_a_${suffix}`;
  const beta = `pub_theme_b_${suffix}`;
  const themeId = `theme-isolation-${suffix}`;

  beforeAll(async () => {
    await db.insert(publications).values([
      {
        id: alpha,
        workspaceId: "ws_default",
        name: "Theme Settings Alpha",
        slug: alpha,
        primaryLocale: "en",
      },
      {
        id: beta,
        workspaceId: "ws_default",
        name: "Theme Settings Beta",
        slug: beta,
        primaryLocale: "en",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(themeConfigurations).where(
      inArray(themeConfigurations.publicationId, [alpha, beta]),
    );
    await db.delete(themeSettings).where(
      inArray(themeSettings.publicationId, [alpha, beta]),
    );
    await db.delete(publications).where(
      inArray(publications.id, [alpha, beta]),
    );
  });

  it("supports different active themes without overwriting another publication", async () => {
    const now = new Date();
    const config = {
      id: "active",
      themeId,
      themeVersion: "1.0.0",
      settings: { accentColor: "#111111" },
      settingsSchemaVersion: 1,
      activatedBy: null,
      activatedAt: now,
      updatedAt: now,
    };
    await activeRepo.setActive(config, alpha);
    await activeRepo.setActive(
      {
        ...config,
        themeId: "vibress-minimal",
        settings: { accentColor: "#222222" },
      },
      beta,
    );

    expect((await activeRepo.getActive(alpha))?.themeId).toBe(themeId);
    expect((await activeRepo.getActive(beta))?.themeId).toBe("vibress-minimal");
    expect((await activeRepo.getActive(alpha))?.settings).toEqual({
      accentColor: "#111111",
    });
    expect(await activeRepo.getActive("pub_unrelated_theme_test")).toBeNull();

    // Repeated activations must update only the corresponding publication.
    await activeRepo.setActive(
      { ...config, settings: { accentColor: "#333333" } },
      alpha,
    );
    expect((await activeRepo.getActive(alpha))?.settings).toEqual({
      accentColor: "#333333",
    });
    expect((await activeRepo.getActive(beta))?.settings).toEqual({
      accentColor: "#222222",
    });
  });

  it("keeps settings for identical theme IDs independent across publications", async () => {
    await installedRepo.saveThemeSettings(
      themeId,
      { headline: "Alpha only" },
      alpha,
    );
    await installedRepo.saveThemeSettings(
      themeId,
      { headline: "Beta only" },
      beta,
    );

    expect(await installedRepo.getThemeSettings(themeId, alpha)).toEqual({
      headline: "Alpha only",
    });
    expect(await installedRepo.getThemeSettings(themeId, beta)).toEqual({
      headline: "Beta only",
    });

    await installedRepo.saveThemeSettings(
      themeId,
      { headline: "Alpha updated" },
      alpha,
    );
    expect(await installedRepo.getThemeSettings(themeId, beta)).toEqual({
      headline: "Beta only",
    });
  });

  it("does not delete another publication's saved settings", async () => {
    await installedRepo.delete(themeId, beta);
    expect(await installedRepo.getThemeSettings(themeId, beta)).toBeNull();
    expect(await installedRepo.getThemeSettings(themeId, alpha)).toEqual({
      headline: "Alpha updated",
    });
  });
});
