import { Plugin, PluginHost } from "@vibress/plugins";
import { validateManifest, type PluginManifest, type PluginModule } from "@vibress/plugin-sdk";
import { isDeepStrictEqual } from "node:util";
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
  private readonly registry = new Map<string, { manifest: unknown; module: PluginModule }>([
    ["vibress-content-metrics", {
      manifest: contentMetricsManifest,
      module: contentMetricsPlugin,
    }],
  ]);

  requiresPublicationEnablement(plugin: Plugin): boolean {
    return !this.registry.has(plugin.manifestId);
  }

  async getOperatorManifests(): Promise<PluginManifest[]> {
    return this.external.listTrustedManifests();
  }

  async authorizeRegistration(manifest: PluginManifest): Promise<void> {
    const builtin = this.registry.get(manifest.id);
    if (builtin) {
      if (!isDeepStrictEqual(validateManifest(builtin.manifest), manifest)) {
        throw new Error("Bundled plugin manifest differs from installed module");
      }
      return;
    }
    const approved = (await this.external.listTrustedManifests()).find((p) => p.id === manifest.id);
    if (!approved || !isDeepStrictEqual(approved, manifest)) {
      throw new Error("Plugin manifest is not operator approved");
    }
  }

  async loadModule(plugin: Plugin): Promise<PluginModule | null> {
    const entry = this.registry.get(plugin.manifestId);
    if (entry) return entry.module;
    return this.external.loadModule(plugin);
  }
}
