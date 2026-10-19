import { Plugin, PluginHost } from "@vibress/plugins";
import { PluginModule } from "@vibress/plugin-sdk";
import {
  manifest as contentMetricsManifest,
  plugin as contentMetricsPlugin,
} from "./official/example-plugin";
import { TrustedExternalPluginHost } from "./trusted-external-plugin-host";

/**
 * Trusted plugin host: loads only bundled, controlled-source plugins.
 * Operator-vetted ESM modules may be loaded through a separately pinned lockfile.
 * No runtime npm install, no remote code, no arbitrary uploaded packages.
 */
export class BundledPluginHost implements PluginHost {
  private readonly external = new TrustedExternalPluginHost();
  private registry: Record<
    string,
    { manifest: unknown; module: PluginModule }
  > = {
    "vibress-content-metrics": {
      manifest: contentMetricsManifest,
      module: contentMetricsPlugin,
    },
  };

  requiresPublicationEnablement(plugin: Plugin): boolean {
    return !(plugin.manifestId in this.registry);
  }

  async loadModule(plugin: Plugin): Promise<PluginModule | null> {
    const entry = this.registry[plugin.manifestId];
    if (entry) return entry.module;
    return this.external.loadModule(plugin);
  }
}
