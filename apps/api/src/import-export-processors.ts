import { ImportProcessor, ExportCollector } from "@vibress/import-export";
import { SETTING_NAMESPACES } from "@vibress/settings";

interface SettingsServiceLike {
  updateSetting(
    namespace: string,
    key: string,
    value: unknown,
    actorId: string | null,
    publicationId?: string,
  ): Promise<unknown>;
  getStaffSettings(publicationId?: string): Promise<
    Array<{
      namespace: string;
      settings: Array<{ key: string; value: unknown; classification: string }>;
    }>
  >;
}

interface RedirectsServiceLike {
  createRedirect(
    data: {
      source: string;
      destination: string;
      statusCode?: number;
      enabled?: boolean;
    },
    actorId: string | null,
    publicationId?: string,
  ): Promise<unknown>;
  listRedirects(publicationId?: string): Promise<
    Array<{
      source: string;
      destination: string;
      statusCode: number;
      enabled: boolean;
    }>
  >;
}

export interface ProcessorsDeps {
  settingsService: SettingsServiceLike;
  redirectsService: RedirectsServiceLike;
}

/**
 * Native import processor. Only safe portable data is accepted:
 * redirects and non-secret settings. Posts/pages/tags import is
 * validated but deferred to the content domain in future iterations —
 * imported content must pass the same rendering/security rules.
 * Imported plugins/themes are never installed automatically.
 */
export class NativeImportProcessor implements ImportProcessor {
  private redirectsService: RedirectsServiceLike;
  private settingsService: SettingsServiceLike;

  constructor(deps: ProcessorsDeps) {
    this.redirectsService = deps.redirectsService;
    this.settingsService = deps.settingsService;
  }

  async process(
    data: Record<string, unknown>,
    publicationId = "pub_default",
  ): Promise<{
    posts: number;
    pages: number;
    tags: number;
    redirects: number;
  }> {
    let redirectCount = 0;
    const posts = 0;
    const pages = 0;
    const tags = 0;

    // Redirects: validated by the redirects domain (source/destination/scheme)
    if (Array.isArray(data.redirects)) {
      for (const item of data.redirects) {
        if (!item || typeof item !== "object" || Array.isArray(item))
          continue;
        const r = item as Record<string, unknown>;
        if (typeof r.source !== "string" || typeof r.destination !== "string")
          continue;
        try {
          await this.redirectsService.createRedirect(
            {
              source: r.source,
              destination: r.destination,
              statusCode: Number(r.statusCode) || 301,
              enabled: typeof r.enabled === "boolean" ? r.enabled : true,
            },
            null,
            publicationId,
          );
          redirectCount++;
        } catch {
          // Skip invalid redirects; report via summary
        }
      }
    }

    // Settings: only non-secret, known settings pass through settings domain
    if (data.settings && typeof data.settings === "object") {
      for (const [namespace, values] of Object.entries(
        data.settings as Record<string, Record<string, unknown>>,
      )) {
        for (const [key, value] of Object.entries(values || {})) {
          // Imported settings cannot bypass code-injection and credential controls.
          const definition = SETTING_NAMESPACES.find((n) => n.namespace === namespace)?.settings.find((s) => s.key === key);
          if (!definition || definition.classification === "secret" ||
              definition.classification === "internal" || namespace === "code" ||
              (namespace === "site" && key === "locale")) continue;
          try {
            await this.settingsService.updateSetting(
              namespace,
              key,
              value,
              null,
              publicationId,
            );
          } catch {
            // Unknown namespace/setting or secret — skip silently
          }
        }
      }
    }

    return { posts, pages, tags, redirects: redirectCount };
  }
}

/**
 * Native export collector: portable application data with secrets excluded.
 * Session tokens, API key secrets, provider credentials, webhook secrets,
 * and VIBRESS_ENCRYPTION_KEY are never included.
 */
export class NativeExportCollector implements ExportCollector {
  private settingsService: SettingsServiceLike;
  private redirectsService: RedirectsServiceLike;

  constructor(deps: ProcessorsDeps) {
    this.settingsService = deps.settingsService;
    this.redirectsService = deps.redirectsService;
  }

  async collect(publicationId = "pub_default"): Promise<Record<string, unknown>> {
    const settings = await this.settingsService.getStaffSettings(publicationId);
    // Exclude secret/internal classifications from the export
    const safeSettings: Record<string, Record<string, unknown>> = {};
    for (const ns of settings) {
      const safe: Record<string, unknown> = {};
      for (const s of ns.settings) {
        if (s.classification === "secret" || s.classification === "internal")
          continue;
        safe[s.key] = s.value;
      }
      safeSettings[ns.namespace] = safe;
    }

    const redirects = await this.redirectsService.listRedirects(publicationId);

    return {
      settings: safeSettings,
      redirects: redirects.map((r) => ({
        source: r.source,
        destination: r.destination,
        statusCode: r.statusCode,
        enabled: r.enabled,
      })),
    };
  }
}
