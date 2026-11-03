import { z } from "zod";

export const THEME_API_VERSION = 1;

export const ThemeAuthorSchema = z.union([
  z.string().trim().max(100),
  z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().optional(),
    url: z.string().trim().url().optional(),
  }),
]);

export const ThemeLocalizationSchema = z.object({
  supportsLocales: z.array(z.string()).default(["*"]),
  rtl: z.boolean().default(false),
  dynamicLocale: z.boolean().default(true),
  localizedNavigation: z.boolean().default(true),
  localizedDates: z.boolean().default(true),
});

export type ThemeLocalizationConfig = z.infer<typeof ThemeLocalizationSchema>;

export const ThemeManifestSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Theme ID must be lowercase alphanumeric with hyphens",
    ),
  name: z.string().trim().min(1).max(100),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, "Theme version must be valid semver"),
  description: z.string().trim().max(500).optional(),
  author: ThemeAuthorSchema.optional(),
  homepage: z.string().trim().url().optional(),
  license: z.string().trim().max(50).optional(),
  previewImage: z.string().trim().max(500).optional(),
  themeApi: z.number().int().positive().default(THEME_API_VERSION),
  capabilities: z.array(z.string()).default([]),
  localization: ThemeLocalizationSchema.optional(),
  settingsSchemaVersion: z.number().int().positive().default(1),
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

export type ThemeSettingValue = string | number | boolean;

export type SelectOption = { label: string; value: string } | string;

export type StringSettingDefinition = {
  key?: string;
  type: "string";
  default: string;
  label?: string;
  description?: string;
  maxLength?: number;
  minLength?: number;
};

export type BooleanSettingDefinition = {
  key?: string;
  type: "boolean";
  default: boolean;
  label?: string;
  description?: string;
};

export type NumberSettingDefinition = {
  key?: string;
  type: "number";
  default: number;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
};

export type ColorSettingDefinition = {
  key?: string;
  type: "color";
  default: string;
  label?: string;
  description?: string;
};

export type SelectSettingDefinition = {
  key?: string;
  type: "select";
  default: string;
  label?: string;
  description?: string;
  options: SelectOption[];
};

export type ThemeSettingDefinition =
  | StringSettingDefinition
  | BooleanSettingDefinition
  | NumberSettingDefinition
  | ColorSettingDefinition
  | SelectSettingDefinition;

export type ThemeSettingsSchema = Record<string, ThemeSettingDefinition>;

export interface ThemeSiteSettings {
  title: string;
  /** Publication-owned identity assets; themes choose their own presentation. */
  logoUrl?: string | undefined;
  iconUrl?: string | undefined;
  coverUrl?: string | undefined;
  socialLinks?: Array<{ id: string; platform: string; label: string; url: string; iconUrl: string }> | undefined;
  description: string;
  url: string;
  locale: string;
  primaryLocale?: string | undefined;
  enabledLocales?: string[] | undefined;
  direction?: "ltr" | "rtl" | undefined;
  commentsEnabled?: boolean | undefined;
  commentAccess?: string | undefined;
  comments?: {
    commentAccess?: string | undefined;
    preModeration?: boolean | undefined;
  } | undefined;
}

export interface AvailableLocaleItem {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  url: string;
  isCurrent: boolean;
}

export interface ThemeLocaleContext {
  locale: string;
  language: string;
  region?: string | undefined;
  direction: "ltr" | "rtl";
  isRTL: boolean;
  availableLocales: AvailableLocaleItem[];
  currentUrl: string;
  translations?: Record<string, string> | undefined;
}

export interface ThemeContext {
  site: ThemeSiteSettings;
  themeSettings: Record<string, unknown>;
  isPreview: boolean;
  localeContext?: ThemeLocaleContext | undefined;
}

export const ThemeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Theme ID must be lowercase alphanumeric with hyphens",
  );

export const THEME_SETTING_MAX_STRING_LENGTH = 500;
export const THEME_SETTINGS_MAX_BYTES = 50 * 1024;

export class ThemeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ThemeError";
    this.code = code;
  }
}

export class ThemeNotFoundError extends ThemeError {
  constructor(themeId: string) {
    super("THEME_NOT_FOUND", `Theme not found: ${themeId}`);
    this.name = "ThemeNotFoundError";
  }
}

export class ThemeInvalidError extends ThemeError {
  constructor(message: string) {
    super("THEME_INVALID", message);
    this.name = "ThemeInvalidError";
  }
}

export class ThemeIncompatibleError extends ThemeError {
  constructor(themeId: string, actualApi: number) {
    super(
      "THEME_INCOMPATIBLE",
      `Theme ${themeId} uses API version ${actualApi}, required ${THEME_API_VERSION}`,
    );
    this.name = "ThemeIncompatibleError";
  }
}

export class ThemeSettingsInvalidError extends ThemeError {
  constructor(message: string) {
    super("THEME_SETTINGS_INVALID", message);
    this.name = "ThemeSettingsInvalidError";
  }
}

export class ThemeActivationFailedError extends ThemeError {
  constructor(message: string) {
    super("THEME_ACTIVATION_FAILED", message);
    this.name = "ThemeActivationFailedError";
  }
}

export class ThemeSecurityError extends ThemeError {
  constructor(message: string) {
    super("THEME_SECURITY_VIOLATION", message);
    this.name = "ThemeSecurityError";
  }
}

export function validateThemeId(themeId: string): void {
  if (!ThemeIdSchema.safeParse(themeId).success) {
    throw new ThemeNotFoundError(themeId);
  }
}

export function validateThemeManifest(manifest: unknown): ThemeManifest {
  const parsed = ThemeManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ThemeInvalidError(
      `Invalid theme manifest: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function validateThemeCompatibility(manifest: ThemeManifest): void {
  if (manifest.themeApi !== THEME_API_VERSION) {
    throw new ThemeIncompatibleError(manifest.id, manifest.themeApi);
  }
}

export const HEX_COLOR_REGEX =
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isValidHexColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return HEX_COLOR_REGEX.test(value.trim());
}

export function validateThemeSettingsSchema(rawSchema: unknown): ThemeSettingsSchema {
  if (!rawSchema || typeof rawSchema !== "object") {
    return {};
  }

  const schemaMap: ThemeSettingsSchema = {};
  const entries = Array.isArray(rawSchema)
    ? rawSchema.map((item) => [item.key, item] as const)
    : Object.entries(rawSchema);

  for (const [key, def] of entries) {
    if (!key || typeof key !== "string") {
      throw new ThemeSettingsInvalidError(`Theme setting definition key is missing or invalid`);
    }
    if (!def || typeof def !== "object") {
      throw new ThemeSettingsInvalidError(`Theme setting "${key}" definition must be an object`);
    }

    const typedDef = def as any;
    if (typedDef.default === undefined) {
      throw new ThemeSettingsInvalidError(`Theme setting "${key}" is missing mandatory default value`);
    }

    switch (typedDef.type) {
      case "string": {
        if (typeof typedDef.default !== "string") {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" default must be a string`);
        }
        if (typedDef.minLength !== undefined) {
          if (
            typeof typedDef.minLength !== "number" ||
            !Number.isInteger(typedDef.minLength) ||
            typedDef.minLength < 0
          ) {
            throw new ThemeSettingsInvalidError(
              `Theme setting "${key}" minLength must be a non-negative integer`,
            );
          }
        }
        if (typedDef.maxLength !== undefined) {
          if (
            typeof typedDef.maxLength !== "number" ||
            !Number.isInteger(typedDef.maxLength) ||
            typedDef.maxLength < 0
          ) {
            throw new ThemeSettingsInvalidError(
              `Theme setting "${key}" maxLength must be a non-negative integer`,
            );
          }
        }
        if (
          typedDef.minLength !== undefined &&
          typedDef.maxLength !== undefined &&
          typedDef.minLength > typedDef.maxLength
        ) {
          throw new ThemeSettingsInvalidError(
            `Theme setting "${key}" minLength cannot exceed maxLength`,
          );
        }
        if (
          typedDef.minLength !== undefined &&
          typedDef.default.length < typedDef.minLength
        ) {
          throw new ThemeSettingsInvalidError(
            `Theme setting "${key}" default length is below minLength ${typedDef.minLength}`,
          );
        }
        const effectiveMaxLength = typedDef.maxLength ?? THEME_SETTING_MAX_STRING_LENGTH;
        if (typedDef.default.length > effectiveMaxLength) {
          throw new ThemeSettingsInvalidError(
            `Theme setting "${key}" default length exceeds maxLength ${effectiveMaxLength}`,
          );
        }
        break;
      }
      case "boolean": {
        if (typeof typedDef.default !== "boolean") {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" default must be a boolean`);
        }
        break;
      }
      case "number": {
        if (typeof typedDef.default !== "number" || !Number.isFinite(typedDef.default)) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" default must be a finite number`);
        }
        if (
          typedDef.min !== undefined &&
          (!Number.isFinite(typedDef.min) || typedDef.default < typedDef.min)
        ) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" default is below min ${typedDef.min}`);
        }
        if (
          typedDef.max !== undefined &&
          (!Number.isFinite(typedDef.max) || typedDef.default > typedDef.max)
        ) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" default is above max ${typedDef.max}`);
        }
        if (
          typedDef.min !== undefined &&
          typedDef.max !== undefined &&
          typedDef.min > typedDef.max
        ) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" min cannot exceed max`);
        }
        break;
      }
      case "color": {
        if (typeof typedDef.default !== "string" || !isValidHexColor(typedDef.default)) {
          throw new ThemeSettingsInvalidError(
            `Theme setting "${key}" default must be a valid hex color string (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)`,
          );
        }
        break;
      }
      case "select": {
        if (!Array.isArray(typedDef.options) || typedDef.options.length === 0) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" of type "select" must have a non-empty "options" array`);
        }
        const optionValues = typedDef.options.map((opt: any) =>
          typeof opt === "string" ? opt : opt?.value,
        );
        if (optionValues.some((v: any) => typeof v !== "string" || v.length === 0)) {
          throw new ThemeSettingsInvalidError(`Theme setting "${key}" contains invalid option values`);
        }
        if (!optionValues.includes(typedDef.default)) {
          throw new ThemeSettingsInvalidError(
            `Theme setting "${key}" default "${typedDef.default}" is not in allowed options: [${optionValues.join(", ")}]`,
          );
        }
        break;
      }
      default:
        throw new ThemeSettingsInvalidError(`Theme setting "${key}" has unsupported type "${typedDef.type}"`);
    }

    schemaMap[key] = {
      ...typedDef,
      key,
    };
  }

  return schemaMap;
}

export function validateThemeSettings(
  schema: ThemeSettingsSchema,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, def] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined) {
      output[key] = def.default;
      continue;
    }

    const validation = validateSettingValue(key, def, value);
    if (!validation.ok) {
      errors.push(`${key}: ${validation.error}`);
      continue;
    }
    output[key] = validation.value;
  }

  // Reject unknown keys
  for (const key of Object.keys(input)) {
    if (!(key in schema)) {
      errors.push(`${key}: unknown setting key`);
    }
  }

  if (errors.length > 0) {
    throw new ThemeSettingsInvalidError(errors.join("; "));
  }

  return output;
}

export function validateSettingValue(
  _key: string,
  def: ThemeSettingDefinition,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (def.type) {
    case "string": {
      if (typeof value !== "string") {
        return { ok: false, error: "expected string" };
      }
      if (def.minLength !== undefined && value.length < def.minLength) {
        return { ok: false, error: `string length must be at least ${def.minLength}` };
      }
      const maxLength = def.maxLength ?? THEME_SETTING_MAX_STRING_LENGTH;
      if (value.length > maxLength) {
        return { ok: false, error: `string exceeds max length ${maxLength}` };
      }
      return { ok: true, value };
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return { ok: false, error: "expected boolean" };
      }
      return { ok: true, value };
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: "expected finite number" };
      }
      if (def.min !== undefined && value < def.min) {
        return { ok: false, error: `value below min ${def.min}` };
      }
      if (def.max !== undefined && value > def.max) {
        return { ok: false, error: `value above max ${def.max}` };
      }
      return { ok: true, value };
    }
    case "color": {
      if (typeof value !== "string" || !isValidHexColor(value)) {
        return { ok: false, error: "invalid hex color string (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)" };
      }
      return { ok: true, value: value.trim() };
    }
    case "select": {
      if (typeof value !== "string") {
        return { ok: false, error: "expected string" };
      }
      const allowedValues = def.options.map((opt) =>
        typeof opt === "string" ? opt : opt.value,
      );
      if (!allowedValues.includes(value)) {
        return {
          ok: false,
          error: `invalid option, allowed: [${allowedValues.join(", ")}]`,
        };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, error: `unsupported setting type "${(def as any).type}"` };
  }
}

export function mergeThemeSettings(
  schema: ThemeSettingsSchema,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const storedObj = stored && typeof stored === "object" ? stored : {};

  for (const [key, def] of Object.entries(schema)) {
    const val = storedObj[key];
    if (val === undefined) {
      output[key] = def.default;
      continue;
    }
    const validation = validateSettingValue(key, def, val);
    if (validation.ok) {
      output[key] = validation.value;
    } else {
      output[key] = def.default;
    }
  }

  return output;
}

export const REQUIRED_THEME_TEMPLATES = [
  "index",
  "post",
  "page",
] as const;

export function validateThemeTemplateContract(
  availableTemplates: string[],
): { valid: boolean; missing: string[] } {
  const normalized = availableTemplates.map((t) =>
    t.replace(/\.(liquid|html)$/, "").toLowerCase(),
  );
  const missing = REQUIRED_THEME_TEMPLATES.filter(
    (req) => !normalized.includes(req) && !(req === "index" && normalized.includes("home")),
  );
  return {
    valid: missing.length === 0,
    missing,
  };
}
