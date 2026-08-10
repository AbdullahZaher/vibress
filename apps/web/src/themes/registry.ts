import type { VibressThemeDefinition } from './types';
import { defaultTheme } from './default/theme';
import { minimalTheme } from './minimal/theme';
import { moltenTheme } from './molten/theme';

const registry = new Map<string, VibressThemeDefinition>();

export function registerTheme(theme: VibressThemeDefinition): void {
  registry.set(theme.manifest.id, theme);
}

export function getTheme(id: string): VibressThemeDefinition | undefined {
  return registry.get(id);
}

export function hasTheme(id: string): boolean {
  return registry.has(id);
}

export function listThemes(): VibressThemeDefinition[] {
  return Array.from(registry.values());
}

export const DEFAULT_THEME_ID = 'vibress-default';

registerTheme(defaultTheme);
registerTheme(minimalTheme);
registerTheme(moltenTheme);

export function getFallbackTheme(): VibressThemeDefinition {
  return getTheme(DEFAULT_THEME_ID) ?? listThemes()[0]!;
}
