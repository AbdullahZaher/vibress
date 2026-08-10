import { Plugin, PluginHost } from '@vibress/plugins';
import { PluginModule } from '@vibress/plugin-sdk';
import { manifest as contentMetricsManifest, plugin as contentMetricsPlugin } from './official/example-plugin';

/**
 * Trusted plugin host: loads only bundled, controlled-source plugins.
 * No runtime npm install, no remote code, no arbitrary uploaded packages.
 */
export class BundledPluginHost implements PluginHost {
  private registry: Record<string, { manifest: unknown; module: PluginModule }> = {
    'vibress-content-metrics': { manifest: contentMetricsManifest, module: contentMetricsPlugin },
  };

  async loadModule(plugin: Plugin): Promise<PluginModule | null> {
    const entry = this.registry[plugin.manifestId];
    if (!entry) return null;
    return entry.module;
  }
}
