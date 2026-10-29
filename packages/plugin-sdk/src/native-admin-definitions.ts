/**
 * SDK-NUI-02 (experimental): pure TypeScript authoring helpers for the
 * EXISTING Native Admin V1 wire contracts. These functions return their
 * argument without transformation. They neither validate untrusted runtime
 * input nor approve permissions, database models, routes, releases or actions.
 *
 * The Host always validates each declaration against its strict runtime
 * schemas and checks authorization for every operation. No Admin JS/React
 * code, network, filesystem or private Host package is imported here.
 */
import type { PluginNativeAdminPageV1 } from "./native-admin-ui";
import type { PluginAdminDataResourceV1, PluginAdminDataActionV1 } from "./native-admin-data";
import type { PluginAdminDomainWorkflowV1 } from "./native-domain-workflow";

export function defineNativeAdminPageV1<const T extends PluginNativeAdminPageV1>(page: T): T {
  return page;
}

export function defineNativeAdminResourceV1<const T extends PluginAdminDataResourceV1>(resource: T): T {
  return resource;
}

export function defineNativeAdminActionV1<const T extends PluginAdminDataActionV1>(action: T): T {
  return action;
}

export function defineNativeDomainWorkflowV1<const T extends PluginAdminDomainWorkflowV1>(workflow: T): T {
  return workflow;
}

/**
 * SDK-NUI-05: BCP-47 locale-neutral label resolution with graceful fallback.
 * Supports { en, ar } v1 records as well as extended BCP-47 language tags.
 */
export type PluginLocalizedLabel =
  | { readonly en: string; readonly ar: string; readonly [lang: string]: string }
  | { readonly en: string; readonly [lang: string]: string };

export function resolveLocalizedLabel(
  label: PluginLocalizedLabel | string,
  preferredLocale = "en",
  fallbackLocale = "en",
): string {
  if (typeof label === "string") return label;
  if (!label || typeof label !== "object") return "";
  const direct = (label as Record<string, string>)[preferredLocale];
  if (typeof direct === "string" && direct.trim()) return direct;
  const langPrefix = preferredLocale.split("-")[0]?.toLowerCase();
  if (langPrefix) {
    const prefixed = (label as Record<string, string>)[langPrefix];
    if (typeof prefixed === "string" && prefixed.trim()) return prefixed;
  }
  const fallback = (label as Record<string, string>)[fallbackLocale];
  if (typeof fallback === "string" && fallback.trim()) return fallback;
  return (label as Record<string, string>).en || "";
}

/**
 * SDK-NUI-06: Declarative plugin settings, secrets, and media capability descriptors.
 */
export type PluginSettingType = "string" | "number" | "boolean" | "secret" | "media";

export interface PluginSettingFieldDescriptor {
  readonly key: string;
  readonly type: PluginSettingType;
  readonly label: PluginLocalizedLabel;
  readonly description?: PluginLocalizedLabel | undefined;
  readonly required?: boolean | undefined;
  readonly isSecret?: boolean | undefined;
  readonly defaultValue?: string | number | boolean | null | undefined;
  readonly mediaAllowedTypes?: readonly ("image" | "video" | "document")[] | undefined;
}

export interface PluginSettingsSchemaDescriptor {
  readonly version: 1;
  readonly fields: readonly PluginSettingFieldDescriptor[];
}

export function defineSettingsSchema<const T extends PluginSettingsSchemaDescriptor>(schema: T): T {
  return schema;
}

export function maskSecretValue(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return value.slice(0, 2) + "••••••••" + value.slice(-2);
}
