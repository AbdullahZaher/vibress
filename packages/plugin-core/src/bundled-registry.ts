import { PluginManifest, PluginContext } from "./index";
import { PluginSecurityViolationError, verifyPluginCapabilityPermission } from "./sandbox";

export interface BundledPlugin {
  id: string;
  manifest: PluginManifest;
  executeHook<T = unknown>(
    hookName: string,
    payload: unknown,
    context: PluginContext,
  ): Promise<T> | T;
}

export class BundledPluginRegistry {
  private plugins: Map<string, BundledPlugin> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  /**
   * Registers a verified, bundled plugin.
   */
  register(plugin: BundledPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  get(pluginId: string): BundledPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Executes a hook on a verified bundled plugin with capability verification.
   * Untrusted/unregistered plugins fail closed with PluginSecurityViolationError.
   */
  async executeHook<T = unknown>(
    pluginId: string,
    hookName: string,
    payload: unknown,
    context: PluginContext,
  ): Promise<T> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginSecurityViolationError(
        `Untrusted plugin '${pluginId}' execution rejected. Dynamic arbitrary plugin execution is disabled for security in Vibress v1.x. Only verified bundled plugins are permitted.`,
      );
    }

    // Enforce capability permission based on hook type
    if (hookName === "onEvent") {
      verifyPluginCapabilityPermission(plugin.manifest, "events.read");
    } else if (hookName === "transformPost" || hookName === "calculateMetrics") {
      verifyPluginCapabilityPermission(plugin.manifest, "posts.read");
    }

    return plugin.executeHook<T>(hookName, payload, context);
  }

  /**
   * Registers official built-in plugins bundled into the Vibress core distribution.
   */
  private registerBuiltins(): void {
    // 1. Content Metrics Plugin (reading time, word count, content statistics)
    this.register({
      id: "vibress-content-metrics",
      manifest: {
        id: "vibress-content-metrics",
        name: "Vibress Content Metrics",
        version: "1.0.0",
        description: "Calculates content statistics and estimated reading time",
        capabilities: ["posts.read"],
      },
      executeHook: async <T>(hookName: string, payload: unknown): Promise<T> => {
        if (hookName === "calculateMetrics") {
          const input = (payload as { text?: string; html?: string }) || {};
          const text = input.text || (input.html ? input.html.replace(/<[^>]*>/g, "") : "");
          const words = text.trim() ? text.trim().split(/\s+/).length : 0;
          const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

          return {
            wordCount: words,
            readingTimeMinutes,
            characterCount: text.length,
          } as unknown as T;
        }
        return { executed: true, hook: hookName } as unknown as T;
      },
    });

    // 2. Analytics Tracker Plugin
    this.register({
      id: "analytics-tracker",
      manifest: {
        id: "analytics-tracker",
        name: "Analytics Tracker",
        version: "1.0.0",
        description: "Official analytics event listener",
        capabilities: ["events.read"],
      },
      executeHook: async <T>(hookName: string, payload: unknown): Promise<T> => {
        return {
          executed: true,
          hook: hookName,
          payload,
          processedAt: new Date().toISOString(),
        } as unknown as T;
      },
    });
  }
}

export const defaultBundledPluginRegistry = new BundledPluginRegistry();
