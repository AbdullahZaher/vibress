import { runInTransaction } from "@vibress/database";
import type { SettingRepository } from "../domain/setting";

/**
 * A publication's language configuration is independent from which interface
 * language its staff member might personally prefer.
 */
export interface PublicationLocaleConfiguration {
  primaryLocale: string;
  enabledLocales: string[];
  isMultilingual: boolean;
  /** Existing installations can require an explicit, non-destructive repair. */
  needsReconciliation: boolean;
}

export interface PublicationLocaleSnapshot {
  primaryLocale: string;
  locales: Array<{ locale: string; status: string; isDefault: boolean }>;
}

export interface PublicationLocaleRepository {
  load(publicationId: string, forUpdate?: boolean): Promise<PublicationLocaleSnapshot | null>;
  save(publicationId: string, primaryLocale: string, enabledLocales: string[]): Promise<void>;
  hasAuthoredContent(publicationId: string): Promise<boolean>;
  listPublicTranslationLocales(publicationId: string): Promise<string[]>;
}

export class PublicationLocaleError extends Error {
  constructor(
    public readonly code:
      | "PUBLICATION_NOT_FOUND"
      | "INVALID_LOCALE_CONFIGURATION"
      | "LOCALE_RECONCILIATION_REQUIRED"
      | "PRIMARY_LOCALE_CHANGE_REQUIRES_MIGRATION"
      | "PUBLISHED_LOCALE_REQUIRES_REVIEW",
    message: string,
  ) {
    super(message);
    this.name = "PublicationLocaleError";
  }
}

/** Check input before Intl canonicalization; do not silently accept malformed tags. */
export function canonicalPublicationLocale(raw: string): string {
  if (
    typeof raw !== "string" ||
    !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(raw)
  ) {
    throw new PublicationLocaleError("INVALID_LOCALE_CONFIGURATION", "Invalid language tag");
  }
  try {
    const canonical = Intl.getCanonicalLocales(raw);
    if (canonical.length !== 1 || !canonical[0]) throw new RangeError("Invalid locale");
    return canonical[0];
  } catch {
    throw new PublicationLocaleError("INVALID_LOCALE_CONFIGURATION", "Invalid language tag");
  }
}

function parseEnabledLocales(
  primaryLocale: string,
  enabledLocales: readonly string[],
): string[] {
  if (!Array.isArray(enabledLocales) || enabledLocales.length < 1 || enabledLocales.length > 20) {
    throw new PublicationLocaleError(
      "INVALID_LOCALE_CONFIGURATION",
      "Choose between 1 and 20 enabled languages",
    );
  }
  const canonical = enabledLocales.map(canonicalPublicationLocale);
  if (new Set(canonical).size !== canonical.length || !canonical.includes(primaryLocale)) {
    throw new PublicationLocaleError(
      "INVALID_LOCALE_CONFIGURATION",
      "Enabled languages must be unique and include the primary language",
    );
  }
  return [primaryLocale, ...canonical.filter((locale) => locale !== primaryLocale)];
}

export class PublicationLocaleService {
  constructor(
    private readonly repository: PublicationLocaleRepository,
    private readonly settings: SettingRepository,
  ) {}

  async getConfiguration(publicationId: string): Promise<PublicationLocaleConfiguration> {
    if (!publicationId) {
      throw new PublicationLocaleError("PUBLICATION_NOT_FOUND", "Publication not found");
    }
    const snapshot = await this.repository.load(publicationId);
    if (!snapshot) {
      throw new PublicationLocaleError("PUBLICATION_NOT_FOUND", "Publication not found");
    }
    const legacy = await this.settings.get("site", "locale", publicationId);
    const current = this.resolve(snapshot, legacy?.value);
    if (snapshot.locales.length === 0) {
      // Upgrade bridge: retain URLs that were genuinely published before
      // locale enablement was modeled, without persisting inferred state.
      // Draft/approved rows do not enable a locale; require reconciliation.
      const published = await this.repository.listPublicTranslationLocales(publicationId);
      const legacyPublished = [...new Set(published.map(canonicalPublicationLocale))]
        .filter((locale) => locale !== current.primaryLocale);
      if (legacyPublished.length) {
        const enabledLocales = [...current.enabledLocales, ...legacyPublished];
        return {
          ...current,
          enabledLocales,
          isMultilingual: enabledLocales.length > 1,
          needsReconciliation: true,
        };
      }
    }
    return current;
  }

  /**
   * Reconcile only in memory on reads. Existing Arabic installations set
   * site.locale=ar while the publication's initial DB locale remained en.
   * Keep serving that explicit choice, without mutating the original rows.
   */
  private resolve(
    snapshot: PublicationLocaleSnapshot,
    legacyValue: unknown,
  ): PublicationLocaleConfiguration {
    const persistedPrimary = canonicalPublicationLocale(snapshot.primaryLocale);
    const legacyLocale =
      typeof legacyValue === "string" && legacyValue.length > 0
        ? canonicalPublicationLocale(legacyValue)
        : null;
    // Legacy setup wrote site.locale but left primary_locale='en'. Prefer that
    // explicit choice only if a canonical active default has never been set.
    const hasCanonicalDefault = snapshot.locales.some(
      (row) =>
        row.status === "active" &&
        row.isDefault &&
        canonicalPublicationLocale(row.locale) === persistedPrimary,
    );
    const primaryLocale =
      persistedPrimary === "en" &&
      legacyLocale &&
      legacyLocale !== "en" &&
      !hasCanonicalDefault
        ? legacyLocale
        : persistedPrimary;

    const activeLocales: string[] = [];
    const allLocales = new Set<string>();
    let needsReconciliation = Boolean(legacyLocale && legacyLocale !== persistedPrimary);

    for (const row of snapshot.locales) {
      const locale = canonicalPublicationLocale(row.locale);
      if (row.locale !== locale) needsReconciliation = true;
      if (allLocales.has(locale)) {
        needsReconciliation = true;
      }
      allLocales.add(locale);
      if (row.status === "active") {
        if (!activeLocales.includes(locale)) activeLocales.push(locale);
      }
      if (row.isDefault !== (row.status === "active" && locale === primaryLocale)) {
        needsReconciliation = true;
      }
    }

    if (snapshot.locales.length > 0 && !activeLocales.includes(primaryLocale)) {
      needsReconciliation = true;
    }
    const enabledLocales = [
      primaryLocale,
      ...activeLocales.filter((locale) => locale !== primaryLocale),
    ];
    return {
      primaryLocale,
      enabledLocales,
      isMultilingual: enabledLocales.length > 1,
      needsReconciliation,
    };
  }

  /**
   * All writes are serialized on the publication row. A legacy site.locale
   * write is projected from this operation within the same transaction.
   */
  async updateConfiguration(
    publicationId: string,
    requested: { primaryLocale: string; enabledLocales: string[] },
    actorId: string | null,
  ): Promise<PublicationLocaleConfiguration> {
    if (!publicationId) {
      throw new PublicationLocaleError("PUBLICATION_NOT_FOUND", "Publication not found");
    }
    const primaryLocale = canonicalPublicationLocale(requested.primaryLocale);
    const enabledLocales = parseEnabledLocales(primaryLocale, requested.enabledLocales);
    return runInTransaction(async () => {
      const snapshot = await this.repository.load(publicationId, true);
      if (!snapshot) {
        throw new PublicationLocaleError("PUBLICATION_NOT_FOUND", "Publication not found");
      }
      const legacy = await this.settings.get("site", "locale", publicationId);
      const normalizedExisting = snapshot.locales.map((row) =>
        canonicalPublicationLocale(row.locale),
      );
      if (new Set(normalizedExisting).size !== normalizedExisting.length) {
        throw new PublicationLocaleError(
          "LOCALE_RECONCILIATION_REQUIRED",
          "Duplicate legacy language tags require an explicit reconciliation",
        );
      }
      const current = this.resolve(snapshot, legacy?.value);
      const storedPrimary = canonicalPublicationLocale(snapshot.primaryLocale);
      const changesPrimary = current.primaryLocale !== primaryLocale ||
        storedPrimary !== primaryLocale;
      if (changesPrimary && !["en", "ar"].includes(primaryLocale.split("-")[0] || "")) {
        throw new PublicationLocaleError(
          "INVALID_LOCALE_CONFIGURATION",
          "The selected primary language is not yet certified for the administrative interface",
        );
      }
      if (changesPrimary && (await this.repository.hasAuthoredContent(publicationId))) {
        throw new PublicationLocaleError(
          "PRIMARY_LOCALE_CHANGE_REQUIRES_MIGRATION",
          "Changing the primary language of a populated publication requires a content migration",
        );
      }

      // Do not silently retire a historically public locale on upgrade.
      const publicLocales = await this.repository.listPublicTranslationLocales(publicationId);
      for (const locale of publicLocales) {
        if (!enabledLocales.includes(canonicalPublicationLocale(locale))) {
          throw new PublicationLocaleError(
            "PUBLISHED_LOCALE_REQUIRES_REVIEW",
            "Review published translated URLs before disabling a language",
          );
        }
      }

      // A primary-vs-legacy semantic conflict needs operator review when
      // source content exists. Simple metadata repair (e.g. a missing default
      // flag) may safely proceed without relabeling existing content.
      const legacyPrimary =
        typeof legacy?.value === "string" && legacy.value.length > 0
          ? canonicalPublicationLocale(legacy.value)
          : null;
      if (
        legacyPrimary &&
        legacyPrimary !== storedPrimary &&
        (await this.repository.hasAuthoredContent(publicationId))
      ) {
        throw new PublicationLocaleError(
          "LOCALE_RECONCILIATION_REQUIRED",
          "Resolve conflicting publication language settings before changing languages",
        );
      }

      await this.repository.save(publicationId, primaryLocale, enabledLocales);
      await this.settings.set({
        namespace: "site",
        key: "locale",
        publicationId,
        value: primaryLocale,
        valueType: "string",
        classification: "public",
        updatedBy: actorId,
      });
      return {
        primaryLocale,
        enabledLocales,
        isMultilingual: enabledLocales.length > 1,
        needsReconciliation: false,
      };
    });
  }
}
