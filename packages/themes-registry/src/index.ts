import { ThemeManifest, ThemeSettingsSchema, ThemeError } from '@vibress/theme-core';

export const DEFAULT_THEME_ID = 'vibress-default';
export const FALLBACK_THEME_ID = 'vibress-default';

export interface RegisteredThemeMetadata {
  manifest: ThemeManifest;
  settingsSchema: ThemeSettingsSchema;
}

export const defaultThemeManifest: ThemeManifest = {
  id: 'vibress-default',
  name: 'Vibress Default',
  version: '1.0.0',
  description: 'The default Vibress theme with a clean reading layout.',
  author: 'Vibress',
  themeApi: 1,
  capabilities: ['post', 'page', 'tagArchive', 'authorArchive'],
  settingsSchemaVersion: 1,
};

export const defaultThemeSettingsSchema: ThemeSettingsSchema = {
  accentColor: { type: 'color', default: '#f05230' },
  contentWidth: { type: 'number', default: 800, min: 600, max: 1600 },
  colorScheme: { type: 'select', default: 'Light', options: ['Light', 'Dark', 'Auto'] },
  titleFont: { type: 'select', default: 'Modern sans-serif', options: ['Modern sans-serif', 'Elegant serif'] },
  bodyFont: { type: 'select', default: 'Elegant serif', options: ['Modern sans-serif', 'Elegant serif'] },
  navigationLayout: { type: 'select', default: 'Logo on cover', options: ['Logo on cover', 'Logo in the middle', 'Stacked'] },
  headerStyle: { type: 'select', default: 'Center aligned', options: ['Center aligned', 'Left aligned', 'Hidden'] },
  showPublicationCover: { type: 'boolean', default: true },
  showAuthor: { type: 'boolean', default: true },
  showPublicationDate: { type: 'boolean', default: true },
  footerText: { type: 'string', default: 'All rights reserved.', maxLength: 200 },
};

export const minimalThemeManifest: ThemeManifest = {
  id: 'vibress-minimal',
  name: 'Vibress Minimal',
  version: '1.0.0',
  description: 'A stark, typography-first minimal theme.',
  author: 'Vibress',
  themeApi: 1,
  capabilities: ['post', 'page', 'tagArchive', 'authorArchive'],
  settingsSchemaVersion: 1,
};

export const minimalThemeSettingsSchema: ThemeSettingsSchema = {
  accentColor: { type: 'color', default: '#000000' },
  backgroundColor: { type: 'color', default: '#ffffff' },
  typography: { type: 'select', default: 'Sans-serif', options: ['Sans-serif', 'Serif'] },
  headerStyle: { type: 'select', default: 'Magazine', options: ['Magazine', 'Highlight', 'Classic'] },
  showAuthor: { type: 'boolean', default: true },
  showPublicationDate: { type: 'boolean', default: true },
  footerText: { type: 'string', default: 'Built with Vibress.', maxLength: 200 },
};

export const moltenThemeManifest: ThemeManifest = {
  id: 'vibress-molten',
  name: 'Vibress Molten',
  version: '1.0.0',
  description: 'A beautiful Molten theme ported to Vibress.',
  author: 'Vibress',
  themeApi: 1,
  capabilities: ['post', 'page', 'tagArchive', 'authorArchive'],
  settingsSchemaVersion: 1,
};

export const moltenThemeSettingsSchema: ThemeSettingsSchema = {
  accentColor: { type: 'color', default: '#f05230' },
  navigationLayout: { type: 'select', default: 'Logo in the middle', options: ['Logo on the left', 'Logo in the middle', 'Stacked'] },
  titleFont: { type: 'select', default: 'Modern sans-serif', options: ['Modern sans-serif', 'Elegant serif'] },
  bodyFont: { type: 'select', default: 'Modern sans-serif', options: ['Modern sans-serif', 'Elegant serif'] },
  showRelatedPosts: { type: 'boolean', default: true },
};

const registry = new Map<string, RegisteredThemeMetadata>();

export function registerThemeMetadata(meta: RegisteredThemeMetadata): void {
  registry.set(meta.manifest.id, meta);
}

export function getThemeMetadata(id: string): RegisteredThemeMetadata | undefined {
  return registry.get(id);
}

export function hasThemeMetadata(id: string): boolean {
  return registry.has(id);
}

export function listThemeMetadata(): RegisteredThemeMetadata[] {
  return Array.from(registry.values());
}

registerThemeMetadata({ manifest: defaultThemeManifest, settingsSchema: defaultThemeSettingsSchema });
registerThemeMetadata({ manifest: minimalThemeManifest, settingsSchema: minimalThemeSettingsSchema });
registerThemeMetadata({ manifest: moltenThemeManifest, settingsSchema: moltenThemeSettingsSchema });

export function resolveThemeMetadata(id: string): RegisteredThemeMetadata {
  const meta = getThemeMetadata(id);
  if (meta) return meta;
  const fallback = getThemeMetadata(FALLBACK_THEME_ID);
  if (!fallback) {
    throw new ThemeError('THEME_NOT_FOUND', `No theme metadata available for ${id}`);
  }
  return fallback;
}
