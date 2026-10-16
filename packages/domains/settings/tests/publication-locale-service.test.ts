import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicationLocaleError,
  PublicationLocaleService,
  canonicalPublicationLocale,
  type PublicationLocaleRepository,
  type PublicationLocaleSnapshot,
} from "../src/application/publication-locale-service";
import type {
  SettingRecord,
  SettingRepository,
} from "../src/domain/setting";

// Domain-only tests: no Postgres needed. Integration coverage exercises
// the real transactional Drizzle adapter separately.
vi.mock("@vibress/database", () => ({
  runInTransaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
}));

function storedSetting(publicationId: string, locale: string): SettingRecord {
  return {
    id: publicationId + ".locale",
    namespace: "site",
    key: "locale",
    value: locale,
    classification: "public",
    valueType: "string",
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("PublicationLocaleService — single language by default", () => {
  const publications = new Map<string, PublicationLocaleSnapshot>();
  const legacy = new Map<string, string>();
  const authored = new Set<string>();
  const publicTranslations = new Map<string, string[]>();

  const repository: PublicationLocaleRepository = {
    load: vi.fn(async (publicationId) => {
      const snapshot = publications.get(publicationId);
      return snapshot
        ? { primaryLocale: snapshot.primaryLocale, locales: snapshot.locales.map((row) => ({ ...row })) }
        : null;
    }),
    save: vi.fn(async (publicationId, primaryLocale, enabledLocales) => {
      const snapshot = publications.get(publicationId);
      if (!snapshot) throw new Error("Missing fixture publication");
      const oldRows = snapshot.locales.map((row) => {
        const locale = canonicalPublicationLocale(row.locale);
        return {
          ...row,
          locale,
          status: enabledLocales.includes(locale) ? "active" : "inactive",
          isDefault: locale === primaryLocale,
        };
      });
      for (const locale of enabledLocales) {
        if (!oldRows.some((row) => row.locale === locale)) {
          oldRows.push({
            locale,
            status: "active",
            isDefault: locale === primaryLocale,
          });
        }
      }
      publications.set(publicationId, { primaryLocale, locales: oldRows });
    }),
    hasAuthoredContent: vi.fn(async (publicationId) => authored.has(publicationId)),
    listPublicTranslationLocales: vi.fn(async (publicationId) =>
      publicTranslations.get(publicationId) || [],
    ),
  };
  const settings: SettingRepository = {
    get: vi.fn(async (namespace, key, publicationId) => {
      if (namespace !== "site" || key !== "locale" || !publicationId) return null;
      const locale = legacy.get(publicationId);
      return locale ? storedSetting(publicationId, locale) : null;
    }),
    getMany: vi.fn(async () => []),
    set: vi.fn(async (record) => {
      if (record.namespace === "site" && record.key === "locale") {
        legacy.set(record.publicationId || "pub_default", String(record.value));
      }
      return storedSetting(record.publicationId || "pub_default", String(record.value));
    }),
    delete: vi.fn(async (namespace, key, publicationId) => {
      if (namespace === "site" && key === "locale" && publicationId) {
        legacy.delete(publicationId);
      }
    }),
  };

  const service = new PublicationLocaleService(repository, settings);

  beforeEach(() => {
    vi.clearAllMocks();
    publications.clear();
    legacy.clear();
    authored.clear();
    publicTranslations.clear();
    publications.set("pub_a", { primaryLocale: "en", locales: [] });
    publications.set("pub_b", { primaryLocale: "fr", locales: [] });
  });

  it("resolves an English publication to English only without implicit Arabic", async () => {
    expect(await service.getConfiguration("pub_a")).toEqual({
      primaryLocale: "en",
      enabledLocales: ["en"],
      isMultilingual: false,
      needsReconciliation: false,
    });
  });

  it("preserves an explicit legacy Arabic site locale without silently changing the DB", async () => {
    legacy.set("pub_a", "ar");
    expect(await service.getConfiguration("pub_a")).toEqual({
      primaryLocale: "ar",
      enabledLocales: ["ar"],
      isMultilingual: false,
      needsReconciliation: true,
    });
    expect(publications.get("pub_a")?.primaryLocale).toBe("en");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not let stale legacy site.locale override a configured canonical default", async () => {
    legacy.set("pub_a", "ar");
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [{ locale: "en", status: "active", isDefault: true }],
    });
    expect(await service.getConfiguration("pub_a")).toMatchObject({
      primaryLocale: "en",
      enabledLocales: ["en"],
      needsReconciliation: true,
    });
  });

  it("only activates locales explicitly marked active on the publication", async () => {
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [
        { locale: "en", status: "active", isDefault: true },
        { locale: "fr", status: "active", isDefault: false },
        { locale: "ar-SA", status: "inactive", isDefault: false },
      ],
    });
    expect(await service.getConfiguration("pub_a")).toMatchObject({
      primaryLocale: "en",
      enabledLocales: ["en", "fr"],
      isMultilingual: true,
      needsReconciliation: false,
    });
  });

  it("preserves historical published URLs even when locale rows already exist", async () => {
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [{ locale: "en", status: "active", isDefault: true }],
    });
    publicTranslations.set("pub_a", ["ar-SA", "fr"]);
    const config = await service.getConfiguration("pub_a");
    expect(config.enabledLocales).toEqual(["en", "ar-SA", "fr"]);
    expect(config.isMultilingual).toBe(true);
    expect(config.needsReconciliation).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not reactivate unpublished draft-only languages on upgrade", async () => {
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [
        { locale: "en", status: "active", isDefault: true },
        { locale: "ar-SA", status: "inactive", isDefault: false },
      ],
    });
    // The repository returns public states only, not drafts.
    expect(await service.getConfiguration("pub_a")).toEqual({
      primaryLocale: "en",
      enabledLocales: ["en"],
      isMultilingual: false,
      needsReconciliation: false,
    });
  });

  it("never reads another publication's language settings", async () => {
    legacy.set("pub_a", "ar");
    const second = await service.getConfiguration("pub_b");
    expect(second.enabledLocales).toEqual(["fr"]);
    expect(settings.get).toHaveBeenCalledWith("site", "locale", "pub_b");
  });

  it("rejects an unknown or empty publication ID", async () => {
    await expect(service.getConfiguration("")).rejects.toMatchObject({
      code: "PUBLICATION_NOT_FOUND",
    });
    await expect(service.getConfiguration("foreign_pub")).rejects.toMatchObject({
      code: "PUBLICATION_NOT_FOUND",
    });
  });

  it("canonicalizes BCP 47 tags and detects invalid tags", () => {
    expect(canonicalPublicationLocale("ar-sa")).toBe("ar-SA");
    expect(canonicalPublicationLocale("zh-hans-cn")).toBe("zh-Hans-CN");
    expect(() => canonicalPublicationLocale("ar_foo")).toThrow(PublicationLocaleError);
  });

  it("atomically projects a new canonical primary into legacy settings", async () => {
    const updated = await service.updateConfiguration("pub_a", {
      primaryLocale: "ar-SA",
      enabledLocales: ["ar-sa"],
    }, "owner");
    expect(updated).toMatchObject({
      primaryLocale: "ar-SA",
      enabledLocales: ["ar-SA"],
      needsReconciliation: false,
    });
    expect(publications.get("pub_a")?.primaryLocale).toBe("ar-SA");
    expect(publications.get("pub_a")?.locales).toEqual([
      { locale: "ar-SA", status: "active", isDefault: true },
    ]);
    expect(legacy.get("pub_a")).toBe("ar-SA");
    expect(settings.set).toHaveBeenCalledWith(
      expect.objectContaining({ publicationId: "pub_a", updatedBy: "owner" }),
    );
  });

  it("rejects duplicate locale variants or a missing primary", async () => {
    await expect(service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en", "AR-sa", "ar-SA"],
    }, "owner")).rejects.toMatchObject({ code: "INVALID_LOCALE_CONFIGURATION" });

    await expect(service.updateConfiguration("pub_a", {
      primaryLocale: "ar", enabledLocales: ["en"],
    }, "owner")).rejects.toMatchObject({ code: "INVALID_LOCALE_CONFIGURATION" });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("blocks changing a populated publication's primary language", async () => {
    authored.add("pub_a");
    await expect(service.updateConfiguration("pub_a", {
      primaryLocale: "ar", enabledLocales: ["ar"],
    }, "owner")).rejects.toMatchObject({
      code: "PRIMARY_LOCALE_CHANGE_REQUIRES_MIGRATION",
    });
    expect(publications.get("pub_a")?.primaryLocale).toBe("en");
  });

  it("can add a secondary locale without altering the source language of stored content", async () => {
    authored.add("pub_a");
    const updated = await service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en", "fr"],
    }, "owner");
    expect(updated.enabledLocales).toEqual(["en", "fr"]);
    expect(publications.get("pub_a")?.primaryLocale).toBe("en");
  });

  it("repairs a missing default marker without relabeling authored content", async () => {
    authored.add("pub_a");
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [{ locale: "en", status: "active", isDefault: false }],
    });
    const result = await service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en", "fr"],
    }, "owner");
    expect(result.needsReconciliation).toBe(false);
    expect(publications.get("pub_a")?.locales).toContainEqual({
      locale: "en", status: "active", isDefault: true,
    });
  });

  it("refuses to retire published translated URLs without an explicit review", async () => {
    publicTranslations.set("pub_a", ["ar-SA"]);
    await expect(service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en"],
    }, "owner")).rejects.toMatchObject({
      code: "PUBLISHED_LOCALE_REQUIRES_REVIEW",
    });
  });

  it("keeps disabled locale rows for reactivation instead of deleting them", async () => {
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [
        { locale: "en", status: "active", isDefault: true },
        { locale: "fr", status: "active", isDefault: false },
      ],
    });
    const updated = await service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en"],
    }, "owner");
    expect(updated.isMultilingual).toBe(false);
    expect(publications.get("pub_a")?.locales).toContainEqual({
      locale: "fr", status: "inactive", isDefault: false,
    });
  });

  it("refuses to silently normalize duplicate legacy active locale variants", async () => {
    publications.set("pub_a", {
      primaryLocale: "en",
      locales: [
        { locale: "ar-sa", status: "active", isDefault: false },
        { locale: "ar-SA", status: "active", isDefault: false },
      ],
    });
    await expect(service.updateConfiguration("pub_a", {
      primaryLocale: "en", enabledLocales: ["en", "ar-SA"],
    }, "owner")).rejects.toMatchObject({
      code: "LOCALE_RECONCILIATION_REQUIRED",
    });
  });
});
