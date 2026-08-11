import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES } from '@vibress/queue';
import {
  createLogger,
  metrics,
  exportMetricsText,
  setRequestTraceContext,
  getRequestTraceContext,
} from '@vibress/observability';
import { createMockUser, createMockPost, createMockMember, withMockEnv } from '@vibress/testing';
import { validatePluginManifest, VibressPlugin } from '@vibress/plugin-core';
import { cn, designTokens } from '@vibress/ui';
import { createTranslator } from '@vibress/i18n';
import { FILES_DOMAIN_DEPRECATED } from '@vibress/files';

describe('Platform Packages Suite (H7)', () => {
  describe('@vibress/queue', () => {
    it('defines standard queue name constants', () => {
      expect(QUEUE_NAMES.EMAIL_DELIVERY).toBe('vibress-email-delivery');
      expect(QUEUE_NAMES.SEARCH).toBe('vibress-search');
      expect(QUEUE_NAMES.AUTOMATIONS_RUN).toBe('vibress-automations');
    });
  });

  describe('@vibress/observability', () => {
    it('manages request trace context via AsyncLocalStorage', async () => {
      await setRequestTraceContext({ requestId: 'req-123', actorId: 'user-456' }, async () => {
        const ctx = getRequestTraceContext();
        expect(ctx?.requestId).toBe('req-123');
        expect(ctx?.actorId).toBe('user-456');
      });
    });

    it('logs structured redacted JSON output', () => {
      const logger = createLogger('test-logger', { redactKeys: ['secret'] });
      expect(() => {
        logger.info('Test log message', { secret: 'my-password', normal: 'safe-value' });
      }).not.toThrow();
    });

    it('records metric counters and gauges', () => {
      metrics.clear();
      metrics.counter('http_requests_total', 1, { path: '/api/health' });
      metrics.counter('http_requests_total', 1, { path: '/api/health' });
      metrics.gauge('active_connections', 42);

      const items = metrics.getMetrics();
      expect(items).toHaveLength(2);
      expect(items.find((m) => m.name === 'http_requests_total')?.value).toBe(2);
      expect(items.find((m) => m.name === 'active_connections')?.value).toBe(42);
    });

    it('exports Prometheus text format with process metrics', () => {
      metrics.clear();
      metrics.counter('http_requests_total', 3, { method: 'GET', path: '/api', status: '2xx' });
      metrics.gauge('active_connections', 7);

      const text = exportMetricsText();
      expect(text).toContain('# TYPE http_requests_total counter');
      expect(text).toContain('http_requests_total{method="GET",path="/api",status="2xx"} 3');
      expect(text).toContain('# TYPE active_connections gauge');
      expect(text).toContain('active_connections 7');
      expect(text).toContain('nodejs_process_uptime_seconds');
      expect(text).toContain('# TYPE nodejs_process_memory_rss_bytes gauge');
    });

    it('escapes label values in Prometheus output', () => {
      metrics.clear();
      metrics.counter('http_requests_total', 1, { path: '/weird"path\n' });
      const text = exportMetricsText();
      expect(text).toContain('path="/weird\\"path\\n"');
    });
  });

  describe('@vibress/testing', () => {
    it('generates test user, post, and member mocks', () => {
      const user = createMockUser({ name: 'Alice' });
      expect(user.name).toBe('Alice');
      expect(user.email).toContain('@vibress.test');

      const post = createMockPost({ title: 'Hello World' });
      expect(post.title).toBe('Hello World');

      const member = createMockMember({ name: 'Bob' });
      expect(member.name).toBe('Bob');
    });

    it('scopes mock environment overrides safely', async () => {
      const original = process.env.NODE_ENV;
      await withMockEnv({ TEST_VAR: 'hello' }, async () => {
        expect(process.env.TEST_VAR).toBe('hello');
      });
      expect(process.env.TEST_VAR).toBeUndefined();
      expect(process.env.NODE_ENV).toBe(original);
    });
  });

  describe('@vibress/plugin-core', () => {
    it('validates plugin manifests correctly', () => {
      const valid = validatePluginManifest({
        id: 'analytics-connector',
        name: 'Analytics Connector',
        version: '1.0.0',
      });
      expect(valid.id).toBe('analytics-connector');

      expect(() => {
        validatePluginManifest({ id: 'INVALID ID!', name: 'Bad' });
      }).toThrow('Invalid plugin manifest');
    });

    it('supports VibressPlugin interface structure', () => {
      const plugin: VibressPlugin = {
        manifest: { id: 'test-plugin', name: 'Test Plugin', version: '1.0.0', capabilities: [] },
        async onActivate(ctx) {
          ctx.log.info('Activated plugin');
        },
      };
      expect(plugin.manifest.id).toBe('test-plugin');
    });
  });

  describe('@vibress/ui', () => {
    it('joins classnames cleanly', () => {
      expect(cn('btn', false, 'btn-primary', null, undefined, 'px-4')).toBe('btn btn-primary px-4');
    });

    it('provides design token definitions', () => {
      expect(designTokens.colors.semantic.success).toBe('#10b981');
      expect(designTokens.radii.full).toBe('9999px');
    });
  });

  describe('@vibress/i18n', () => {
    it('translates and interpolates templates', () => {
      const translator = createTranslator({
        fallbackLocale: 'en',
        dictionary: {
          en: {
            welcome: 'Hello, {name}!',
            goodbye: 'Goodbye, {{name}}!',
          },
          es: {
            welcome: '¡Hola, {name}!',
          },
        },
      });

      expect(translator.translate('welcome', { name: 'World' }, 'en')).toBe('Hello, World!');
      expect(translator.translate('welcome', { name: 'Mundo' }, 'es')).toBe('¡Hola, Mundo!');
      expect(translator.translate('goodbye', { name: 'Alice' })).toBe('Goodbye, Alice!');
    });

    it('uses the configured default locale and falls back to the fallback locale', () => {
      const translator = createTranslator({
        locale: 'es',
        fallbackLocale: 'en',
        dictionary: {
          en: { greeting: 'Hello' },
          es: { greeting: '¡Hola!' },
        },
      });

      expect(translator.t('greeting')).toBe('¡Hola!');
      expect(translator.getLocale()).toBe('es');

      translator.setLocale('de');
      expect(translator.t('greeting')).toBe('Hello');
    });

    it('falls back to the fallback locale when the default locale has no dictionary', () => {
      const translator = createTranslator({
        locale: 'fr',
        fallbackLocale: 'en',
        dictionary: {
          en: { greeting: 'Hello' },
        },
      });

      expect(translator.t('greeting')).toBe('Hello');
    });
  });

  describe('@vibress/files', () => {
    it('exports deprecation flag and re-exports media/storage interfaces', () => {
      expect(FILES_DOMAIN_DEPRECATED).toBe(true);
    });
  });
});
