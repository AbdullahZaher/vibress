import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, publications, themeConfigurations, themeSettings } from "@vibress/database";
import {
  getThemeMetadata,
  hasThemeMetadata,
  listThemeMetadata,
} from "@vibress/themes-registry";
import { validateThemeCompatibility, validateThemeManifest } from "@vibress/theme-core";
import type { ThemeDefinitionRegistry } from "../src/domain/theme-configuration";
import { ThemeService } from "../src/application/theme-service";
import { DrizzleInstalledThemeRepository } from "../src/infrastructure/drizzle-installed-theme-repository";
import { DrizzleThemeConfigurationRepository } from "../src/infrastructure/drizzle-theme-configuration-repository";

const registry: ThemeDefinitionRegistry = {
  get: (themeId) => getThemeMetadata(themeId) ?? null,
  has: hasThemeMetadata,
  list: listThemeMetadata,
  validate: validateThemeManifest,
  checkCompatibility: validateThemeCompatibility,
};

describe("Default theme settings with real PostgreSQL persistence", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const alpha = `theme-save-alpha-${suffix}`;
  const beta = `theme-save-beta-${suffix}`;
  const activeRepo = new DrizzleThemeConfigurationRepository();
  const editorRepo = new DrizzleInstalledThemeRepository();
  const service = new ThemeService(activeRepo, registry, editorRepo);

  beforeAll(async () => {
    await getDb().insert(publications).values([
      { id: alpha, workspaceId: "ws_default", name: "Fresh Alpha", slug: alpha },
      { id: beta, workspaceId: "ws_default", name: "Fresh Beta", slug: beta },
    ]);
  });

  afterAll(async () => {
    await getDb().delete(publications).where(eq(publications.id, alpha));
    await getDb().delete(publications).where(eq(publications.id, beta));
  });

  it("publishes implicit Default settings, even under concurrent saves, without creating a configuration row", async () => {
    expect(await activeRepo.getActive(alpha)).toBeNull();
    await Promise.all([
      service.updateThemeSettings("vibress-default", { accentColor: "#2468ac" }, "editor", alpha),
      service.updateThemeSettings("vibress-default", { accentColor: "#13579b" }, "editor", alpha),
    ]);
    const saved = await editorRepo.getThemeSettings("vibress-default", alpha);
    const effective = await service.getActiveTheme(alpha);
    expect(effective?.settings.accentColor).toBe(saved?.accentColor);
    expect(["#2468ac", "#13579b"]).toContain(saved?.accentColor);
    expect(await activeRepo.getActive(alpha)).toBeNull();
    expect((await getDb().select().from(themeSettings).where(and(
      eq(themeSettings.publicationId, alpha),
      eq(themeSettings.themeId, "vibress-default"),
    )))).toHaveLength(1);
    expect((await getDb().select().from(themeConfigurations).where(
      eq(themeConfigurations.publicationId, alpha),
    ))).toHaveLength(0);
    expect((await service.getActiveTheme(beta))?.settings.accentColor).toBe("#f05230");
  });

  it("never activates a theme by saving inactive settings", async () => {
    await service.updateThemeSettings("vibress-minimal", { accentColor: "#abcdef" }, "editor", alpha);
    expect((await service.getActiveTheme(alpha))?.manifest.id).toBe("vibress-default");
    expect((await editorRepo.getThemeSettings("vibress-minimal", alpha))?.accentColor).toBe("#abcdef");
    expect(await activeRepo.getActive(alpha)).toBeNull();
  });

  it("updates explicitly active settings and rejects stale compare-and-swap writes", async () => {
    await service.activateTheme("vibress-default", "editor", undefined, alpha);
    const old = await activeRepo.getActive(alpha);
    if (!old) throw new Error("Fixture must have active Default theme");
    await service.updateThemeSettings("vibress-default", { accentColor: "#991122" }, "editor", alpha);
    expect((await service.getActiveTheme(alpha))?.settings.accentColor).toBe("#991122");

    expect(await activeRepo.updateSettingsIfUnchanged(old, { accentColor: "#999999" }, alpha)).toBeNull();
    expect((await service.getActiveTheme(alpha))?.settings.accentColor).toBe("#991122");
    expect((await service.getActiveTheme(beta))?.settings.accentColor).toBe("#f05230");
    expect((await getDb().select().from(themeConfigurations).where(
      eq(themeConfigurations.publicationId, alpha),
    ))).toHaveLength(1);
  });

  it("rolls back active configuration if editor settings storage fails", async () => {
    const failingRepo = new DrizzleInstalledThemeRepository();
    failingRepo.saveThemeSettings = async () => { throw new Error("Simulated editor settings failure"); };
    const failingService = new ThemeService(activeRepo, registry, failingRepo);
    await expect(failingService.updateThemeSettings(
      "vibress-default", { accentColor: "#333333" }, "editor", alpha,
    )).rejects.toThrow("Simulated editor settings failure");
    expect((await service.getActiveTheme(alpha))?.settings.accentColor).toBe("#991122");
  });

  it("restores saved settings after switching and keeps other publications isolated", async () => {
    await service.activateTheme("vibress-minimal", "editor", undefined, alpha);
    expect((await service.getActiveTheme(alpha))?.settings.accentColor).toBe("#abcdef");
    await service.activateTheme("vibress-default", "editor", undefined, alpha);
    expect((await service.getActiveTheme(alpha))?.settings.accentColor).toBe("#991122");
    expect((await service.getActiveTheme(beta))?.settings.accentColor).toBe("#f05230");
  });
});
