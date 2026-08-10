import { describe, it, expect } from 'vitest';
import {
  THEME_API_VERSION,
  validateThemeId,
  validateThemeManifest,
  validateThemeCompatibility,
  validateThemeSettings,
  mergeThemeSettings,
  ThemeError,
} from '../theme-core';

describe('Theme Core — Validation', () => {
  it('accepts a valid manifest', () => {
    const manifest = validateThemeManifest({
      id: 'vibress-default',
      name: 'Vibress Default',
      version: '1.0.0',
      themeApi: 1,
    });
    expect(manifest.id).toBe('vibress-default');
    expect(manifest.themeApi).toBe(THEME_API_VERSION);
  });

  it('rejects invalid theme IDs', () => {
    expect(() => validateThemeId('../../evil')).toThrow(ThemeError);
    expect(() => validateThemeId('file:///etc/passwd')).toThrow(ThemeError);
    expect(() => validateThemeId('node:fs')).toThrow(ThemeError);
    expect(() => validateThemeId('UPPERCASE')).toThrow(ThemeError);
    expect(() => validateThemeId('with space')).toThrow(ThemeError);
  });

  it('rejects malformed manifest', () => {
    expect(() => validateThemeManifest({ id: 'x', name: 'X' })).toThrow(ThemeError); // missing version
    expect(() => validateThemeManifest({ id: 'x', name: 'X', version: 'not-semver' })).toThrow(ThemeError);
    expect(() => validateThemeManifest({ id: 'bad id', name: 'X', version: '1.0.0' })).toThrow(ThemeError);
  });

  it('rejects incompatible theme API version', () => {
    const manifest = validateThemeManifest({
      id: 'vibress-old',
      name: 'Old',
      version: '1.0.0',
      themeApi: 999,
    });
    expect(() => validateThemeCompatibility(manifest)).toThrow(ThemeError);
  });

  it('validates settings and applies defaults', () => {
    const schema = {
      accentColor: { type: 'color' as const, default: '#2563eb' },
      showAuthor: { type: 'boolean' as const, default: true },
      contentWidth: { type: 'number' as const, default: 800, min: 600, max: 1600 },
    };
    const result = validateThemeSettings(schema, {});
    expect(result.accentColor).toBe('#2563eb');
    expect(result.showAuthor).toBe(true);
    expect(result.contentWidth).toBe(800);
  });

  it('rejects invalid settings values', () => {
    const schema = {
      accentColor: { type: 'color' as const, default: '#2563eb' },
      contentWidth: { type: 'number' as const, default: 800, min: 600, max: 1600 },
    };
    expect(() => validateThemeSettings(schema, { accentColor: 'javascript:alert(1)' })).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { accentColor: 'url(http://evil)' })).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { contentWidth: 9999 })).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { contentWidth: 'wide' })).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { unknownKey: 'x' })).toThrow(ThemeError);
  });

  it('merges stored settings with defaults and falls back on invalid stored values', () => {
    const schema = {
      accentColor: { type: 'color' as const, default: '#000000' },
      footerText: { type: 'string' as const, default: 'default', maxLength: 100 },
    };
    const merged = mergeThemeSettings(schema, { accentColor: '#123456' });
    expect(merged.accentColor).toBe('#123456');
    expect(merged.footerText).toBe('default');

    // Invalid stored value → falls back to defaults
    const safe = mergeThemeSettings(schema, { accentColor: 'javascript:evil' });
    expect(safe.accentColor).toBe('#000000');
  });
});
