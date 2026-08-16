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
  settingsSchemaVersion: z.number().int().positive().default(1),
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

export type ThemeSettingValue = string | number | boolean;

export type ThemeSettingDefinition =
  | {
      type: "string";
      default: string;
      label?: string;
      description?: string;
      maxLength?: number;
      minLength?: number;
    }
  | {
      type: "boolean";
      default: boolean;
      label?: string;
      description?: string;
    }
  | {
      type: "number";
      default: number;
      label?: string;
      description?: string;
      min?: number;
      max?: number;
    }
  | {
      type: "color";
      default: string;
      label?: string;
      description?: string;
    }
  | {
      type: "select";
      default: string;
      label?: string;
      description?: string;
      options: string[];
    };

export type ThemeSettingsSchema = Record<string, ThemeSettingDefinition>;

export interface ThemeSiteSettings {
  title: string;
  description: string;
  url: string;
  locale: string;
}

export interface ThemeContext {
  site: ThemeSiteSettings;
  themeSettings: Record<string, unknown>;
  isPreview: boolean;
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

function validateSettingValue(
  key: string,
  def: ThemeSettingDefinition,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (def.type) {
    case "string": {
      if (typeof value !== "string")
        return { ok: false, error: "expected string" };
      const maxLength = def.maxLength ?? THEME_SETTING_MAX_STRING_LENGTH;
      if (value.length > maxLength) {
        return { ok: false, error: `string exceeds max length ${maxLength}` };
      }
      return { ok: true, value };
    }
    case "boolean":
      if (typeof value !== "boolean")
        return { ok: false, error: "expected boolean" };
      return { ok: true, value };
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value))
        return { ok: false, error: "expected number" };
      if (def.min !== undefined && value < def.min)
        return { ok: false, error: `value below min ${def.min}` };
      if (def.max !== undefined && value > def.max)
        return { ok: false, error: `value above max ${def.max}` };
      return { ok: true, value };
    }
    case "color": {
      if (typeof value !== "string")
        return { ok: false, error: "expected color string" };
      if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) {
        return { ok: false, error: "invalid color, only hex colors allowed" };
      }
      return { ok: true, value };
    }
    case "select": {
      if (typeof value !== "string")
        return { ok: false, error: "expected string" };
      if (!def.options.includes(value)) {
        return {
          ok: false,
          error: `invalid option, allowed: ${def.options.join(", ")}`,
        };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, error: "unsupported setting type" };
  }
}

export function mergeThemeSettings(
  schema: ThemeSettingsSchema,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  try {
    return validateThemeSettings(schema, stored || {});
  } catch (err) {
    if (err instanceof ThemeError) {
      return validateThemeSettings(schema, {});
    }
    throw err;
  }
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
    t.replace(/\.(liquid|hbs|html|jsx|tsx)$/, "").toLowerCase(),
  );
  const missing = REQUIRED_THEME_TEMPLATES.filter(
    (req) => !normalized.includes(req) && !(req === "index" && normalized.includes("home")),
  );
  return {
    valid: missing.length === 0,
    missing,
  };
}
