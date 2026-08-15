import type { PluginLifecycle, PluginContext } from "@vibress/plugin-sdk";

export default class SampleSeoPlugin implements PluginLifecycle {
  async onActivate(context: PluginContext): Promise<void> {
    context.logger.info("Sample SEO Enhancer activated successfully.");
    
    // Register lifecycle hook using only public SDK APIs
    context.hooks.on("post:publish", async (event) => {
      context.logger.info(`Post published: ${event.postId}`);
    });
  }

  async onDeactivate(): Promise<void> {
    // Cleanup resources
  }
}
