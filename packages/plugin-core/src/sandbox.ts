import vm from "node:vm";
import { PluginManifest, PluginContext } from "./index";

export interface SandboxExecutionOptions {
  timeoutMs?: number;
}

export class PluginSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSecurityViolationError";
  }
}

export function executeSandboxedPluginCode<T>(
  code: string,
  context: PluginContext,
  options: SandboxExecutionOptions = {},
): T {
  const timeout = options.timeoutMs || 2000;

  // Build isolated sandbox global context
  const sandboxContext: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => context.log.info(args.map(String).join(" ")),
      info: (...args: unknown[]) => context.log.info(args.map(String).join(" ")),
      warn: (...args: unknown[]) => context.log.warn(args.map(String).join(" ")),
      error: (...args: unknown[]) => context.log.error(args.map(String).join(" ")),
    },
    context: {
      pluginId: context.pluginId,
      manifest: Object.freeze({ ...context.manifest }),
      settings: Object.freeze({ ...context.settings }),
    },
    JSON,
    Math,
    Date,
    // Explicitly prohibit dangerous globals
    process: undefined,
    require: undefined,
    child_process: undefined,
    fs: undefined,
  };

  const vmContext = vm.createContext(sandboxContext);
  const script = new vm.Script(code);

  return script.runInContext(vmContext, {
    timeout,
    displayErrors: true,
  }) as T;
}

export function verifyPluginCapabilityPermission(
  manifest: PluginManifest,
  requiredCapability: string,
): void {
  if (!manifest.capabilities.includes(requiredCapability)) {
    throw new PluginSecurityViolationError(
      `Plugin '${manifest.id}' does not declare required capability '${requiredCapability}'.`,
    );
  }
}
