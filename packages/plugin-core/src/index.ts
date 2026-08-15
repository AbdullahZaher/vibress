import { z } from "zod";

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9-]+$/,
      "Plugin ID must be lowercase alphanumeric with hyphens",
    ),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  minVibressVersion: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface PluginSettingDefinition {
  key: string;
  type: "string" | "number" | "boolean" | "json";
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
}

export interface PluginContext {
  pluginId: string;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  log: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface VibressPlugin {
  manifest: PluginManifest;
  settingsSchema?: PluginSettingDefinition[];
  onActivate?(context: PluginContext): Promise<void> | void;
  onDeactivate?(context: PluginContext): Promise<void> | void;
  onEvent?(
    eventName: string,
    payload: unknown,
    context: PluginContext,
  ): Promise<void> | void;
}

export function validatePluginManifest(manifest: unknown): PluginManifest {
  const result = PluginManifestSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`,
    );
    throw new Error(`Invalid plugin manifest: ${issues.join("; ")}`);
  }
  return result.data;
}

export * from "./sandbox";
export * from "./extension-host";


