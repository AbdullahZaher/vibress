import { z } from "zod";

export const ThemeManifestDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  previewImage: z.string().optional(),
  themeApi: z.number(),
  capabilities: z.array(z.string()),
  settingsSchemaVersion: z.number(),
});
export type ThemeManifestDto = z.infer<typeof ThemeManifestDtoSchema>;

export const ThemeSummaryDtoSchema = z.object({
  manifest: ThemeManifestDtoSchema,
  settingsSchema: z.record(z.unknown()),
  isActive: z.boolean(),
});
export type ThemeSummaryDto = z.infer<typeof ThemeSummaryDtoSchema>;

export const ActiveThemeDtoSchema = z.object({
  themeId: z.string(),
  themeVersion: z.string(),
  settings: z.record(z.unknown()),
  settingsSchemaVersion: z.number(),
});
export type ActiveThemeDto = z.infer<typeof ActiveThemeDtoSchema>;

export const ThemeSettingsUpdateSchema = z.record(z.unknown());
export type ThemeSettingsUpdateInput = z.infer<
  typeof ThemeSettingsUpdateSchema
>;

export const ThemeActivationResponseSchema = z.object({
  theme: ActiveThemeDtoSchema,
});
export type ThemeActivationResponse = z.infer<
  typeof ThemeActivationResponseSchema
>;

export const ThemePreviewResponseSchema = z.object({
  previewToken: z.string(),
  expiresAt: z.string(),
  themeId: z.string(),
});
export type ThemePreviewResponse = z.infer<typeof ThemePreviewResponseSchema>;
