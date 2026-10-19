import { z } from "zod";

/** Plugin IDs in the Admin API identify platform-installed plugin rows. */
export const PluginPublicationParamsSchema = z.object({
  id: z.string().min(1).max(200),
}).strict();

export const PluginPublicationActivationSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const PluginPublicationStateSchema = z.object({
  pluginId: z.string(),
  publicationId: z.string(),
  enabled: z.boolean(),
}).strict();

/** Only declared string keys may be updated; domain validates declarations. */
export const PluginPublicationSettingsUpdateSchema = z.object({
  settings: z.record(z.string().max(4096).nullable()),
}).strict();

export const PluginPublicationSettingsResponseSchema = z.object({
  settings: z.array(z.object({
    key: z.string(),
    value: z.string().nullable(),
    isSecret: z.boolean(),
    masked: z.boolean(),
  }).strict()),
}).strict();
