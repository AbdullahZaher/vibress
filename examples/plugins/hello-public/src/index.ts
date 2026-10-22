import type { PluginManifest, PluginModule } from "@vibress/plugin-sdk";

/**
 * Reference extension. This package depends only on the public Plugin SDK.
 * No private database, Fastify, theme, queue or publication imports.
 */
export const manifest: PluginManifest = {
  id: "hello-public",
  name: "Hello Public",
  version: "1.0.0",
  vibressApiVersion: "1.0.0",
  description: "A safe reference for the external extension contribution ABI.",
  entrypoint: "dist/index.mjs",
  capabilities: ["extension.routes.public", "extension.routes.admin", "admin.navigation"],
};

export const plugin: PluginModule = {
  async activate(context) {
    context.log("Hello Public activated");
  },
  routes: [
    {
      id: "summary",
      audience: "public",
      method: "GET",
      response: { fields: { headline: "string", count: "number" }, required: ["headline", "count"] },
      handle(_input, scope) {
        return {
          headline: scope.locale?.startsWith("ar") ? "مرحباً بالعالم" : "Hello, world",
          count: 1,
        };
      },
    },
    {
      id: "summary-admin",
      audience: "admin",
      method: "GET",
      permission: "plugins.read",
      response: { fields: { installed: "boolean" }, required: ["installed"] },
      handle() { return { installed: true }; },
    },
  ],
  adminViews: [
    { id: "status", routeId: "summary-admin", title: { en: "Plugin status", ar: "حالة الإضافة" } },
  ],
  adminNavigation: [
    { viewId: "status", label: { en: "Plugin status", ar: "حالة الإضافة" },
      permission: "plugins.read" },
  ],
  publicViews: [{
    id: "overview",
    routeId: "summary",
    title: { en: "Hello extension", ar: "إضافة مرحباً" },
    publishedLocales: ["en", "ar"],
  }],
  async deactivate() {},
};

export default plugin;
