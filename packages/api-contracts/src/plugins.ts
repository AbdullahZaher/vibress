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
