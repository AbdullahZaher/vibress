import type { PluginContext, PluginModule } from "@vibress/plugin-sdk";

const plugin: PluginModule = {
  async activate(context: PluginContext): Promise<void> {
    context.log("Sample SEO Enhancer activated", "info");
  },

  async onEvent(eventName: string, _payload: unknown): Promise<void> {
    if (eventName === "post.published") {
      // Handle a named event from the trusted host.
    }
  },

  async deactivate(): Promise<void> {
    // Release resources before the host marks the plugin inactive.
  },
};

export default plugin;
