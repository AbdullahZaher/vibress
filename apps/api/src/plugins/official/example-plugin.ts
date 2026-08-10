import { PluginModule, PluginContext, SDK_VERSION } from '@vibress/plugin-sdk';

/**
 * Official example plugin: "Content Metrics Logger".
 *
 * Proves the real SDK/lifecycle boundaries:
 * - imports ONLY from @vibress/plugin-sdk
 * - declares capabilities via the manifest
 * - reads its own settings + secrets through the context
 */
export const manifest = {
  id: 'vibress-content-metrics',
  name: 'Content Metrics Logger',
  version: '1.0.0',
  vibressApiVersion: SDK_VERSION,
  description: 'Official example plugin that logs content events for demonstration.',
  entrypoint: 'index.ts',
  capabilities: ['events.subscribe', 'settings.read-own', 'settings.write-own'],
  hooks: ['onEvent'],
  settingsSchema: {
    logLevel: { type: 'string', secret: false },
    webhookUrl: { type: 'string', secret: true },
  },
};

export const plugin: PluginModule = {
  async activate(context: PluginContext): Promise<void> {
    context.log(`Content Metrics Logger v${context.version} activated`, 'info');
    context.log(`Configured log level: ${String(context.settings.logLevel ?? 'info')}`, 'info');
    const webhookUrl = await context.getSecret('webhookUrl');
    if (webhookUrl) {
      context.log('Webhook URL configured (value masked)', 'info');
    }
  },

  async onEvent(eventName: string, payload: unknown): Promise<void> {
    // Example hook: logs post.published events without touching core
    if (eventName === 'post.published') {
      console.log(`[vibress-content-metrics] post published: ${JSON.stringify(payload).slice(0, 200)}`);
    }
  },
};
