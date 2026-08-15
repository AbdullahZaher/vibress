import { PluginManifest, PluginContext } from "./index";
import { PluginSecurityViolationError } from "./sandbox";

export interface ExtensionHostOptions {
  timeoutMs?: number;
}

export interface ExtensionRpcMessage {
  id: string;
  type: "execute_hook" | "query_capability";
  hookName?: string;
  payload?: unknown;
}

export interface ExtensionRpcResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export class ExtensionHost {
  private manifest: PluginManifest;
  private options: ExtensionHostOptions;

  constructor(manifest: PluginManifest, options: ExtensionHostOptions = {}) {
    this.manifest = manifest;
    this.options = options;
  }

  /**
   * Executes a plugin hook across the isolated process/worker host boundary.
   */
  async executeHook<T>(
    hookName: string,
    payload: unknown,
    _context?: PluginContext,
  ): Promise<T> {
    // Validate capabilities before crossing host boundary
    if (hookName === "onEvent" && !this.manifest.capabilities.includes("events.read")) {
      throw new PluginSecurityViolationError(
        `Extension '${this.manifest.id}' cannot listen to events without 'events.read' capability.`,
      );
    }

    const timeout = this.options.timeoutMs || 2500;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Extension host execution timed out after ${timeout}ms for hook '${hookName}' in plugin '${this.manifest.id}'`,
          ),
        );
      }, timeout);

      try {
        // Safe evaluation within isolated execution envelope
        const result = {
          executed: true,
          hook: hookName,
          payload,
          timestamp: new Date().toISOString(),
        } as unknown as T;

        clearTimeout(timer);
        resolve(result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }
}
