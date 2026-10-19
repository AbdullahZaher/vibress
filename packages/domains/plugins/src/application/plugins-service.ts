import {
  PluginRepository,
  PluginSettingRepository,
  Plugin,
  PluginPublicationStateRepository,
} from "../domain/plugin";
import {
  validateManifest,
  PluginManifest,
  PluginContext,
  PluginModule,
} from "@vibress/plugin-sdk";
import { encryptSecret, decryptSecret } from "@vibress/security";
import { domainEvents } from "@vibress/events";

export class PluginDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PluginHost {
  loadModule(plugin: Plugin): Promise<PluginModule | null>;
  requiresPublicationEnablement?(plugin: Plugin): boolean;
}

export class PluginsService {
  constructor(
    private pluginRepo: PluginRepository,
    private settingRepo: PluginSettingRepository,
    private host: PluginHost,
    private publicationStates?: PluginPublicationStateRepository,
  ) {}

  /**
   * Discovers/registers a plugin from its manifest. Validation happens
   * before any state is written; incompatible versions and invalid
   * capabilities are rejected.
   */
  async registerPlugin(
    manifestInput: unknown,
    actorId: string | null,
  ): Promise<Plugin> {
    let manifest: PluginManifest;
    try {
      manifest = validateManifest(manifestInput);
    } catch (err: unknown) {
      throw new PluginDomainError(
        "INVALID_MANIFEST",
        (err as Error).message || "Invalid plugin manifest",
      );
    }

    const existing = await this.pluginRepo.findByManifestId(manifest.id);
    if (existing) {
      // Update metadata (re-registration)
      const updated = await this.pluginRepo.updateMetadata(existing.id, {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || null,
        entrypoint: manifest.entrypoint,
        capabilities: manifest.capabilities,
        hooks: manifest.hooks || [],
        settingsSchema: manifest.settingsSchema,
      });
      domainEvents.emit("plugin.updated", { pluginId: updated.id, actorId });
      return updated;
    }

    const plugin = await this.pluginRepo.create({
      manifestId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      vibressApiVersion: manifest.vibressApiVersion,
      description: manifest.description || null,
      entrypoint: manifest.entrypoint,
      capabilities: manifest.capabilities,
      hooks: manifest.hooks || [],
      settingsSchema: manifest.settingsSchema,
    });
    domainEvents.emit("plugin.registered", { pluginId: plugin.id, actorId });
    return plugin;
  }

  /**
   * Activates a plugin: loads its module via the trusted host and runs
   * activate(). On failure the plugin is marked 'error' — visible but
   * reported as a domain error. In-process crashes are NOT isolated.
   */
  async activatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");

    try {
      const module = await this.host.loadModule(plugin);
      if (!module || typeof module.activate !== "function") {
        throw new Error(
          "Plugin entrypoint does not export an activate function",
        );
      }
      // Existing v1 settings are platform-global. Until publication-scoped
      // settings exist, external packages must never receive global secrets.
      const publicationScoped = this.host.requiresPublicationEnablement?.(plugin) === true;
      const settings = publicationScoped ? {} : await this.loadPlainSettings(plugin.id);
      const context: PluginContext = {
        manifestId: plugin.manifestId,
        name: plugin.name,
        version: plugin.version,
        publicationId: undefined,
        settings,
        getSecret: publicationScoped
          ? async (_key: string) => null
          : (key: string) => this.getDecryptedSecret(plugin.id, key),
        log: (message: string, level: "info" | "warn" | "error" = "info") => {
          console.log(`[plugin:${plugin.manifestId}] [${level}] ${message}`);
        },
        hasCapability: (cap: string) => plugin.capabilities.includes(cap),
      };
      await module.activate(context);
    } catch {
      // Plugin exceptions and filesystem errors may include tokens or operator
      // paths. Never forward those raw messages to callers or domain events.
      await this.pluginRepo.updateStatus(id, "error");
      domainEvents.emit("plugin.activation_failed", {
        pluginId: id,
        error: "Plugin activation failed",
      });
      throw new PluginDomainError("PLUGIN_ACTIVATION_FAILED", "Plugin activation failed");
    }

    const activated = await this.pluginRepo.updateStatus(id, "active");
    domainEvents.emit("plugin.activated", { pluginId: id, actorId });
    return activated;
  }

  /**
   * Executes a plugin hook across active plugins with publication scoping and capability check.
   */
  async executeHook<T = unknown>(
    pluginId: string,
    hookName: string,
    payload: unknown,
    publicationId?: string,
  ): Promise<T> {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) {
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    }
    if (plugin.status !== "active") {
      throw new PluginDomainError(
        "PLUGIN_INACTIVE",
        `Plugin '${plugin.manifestId}' is ${plugin.status}. Only active plugins can process hooks.`,
      );
    }
    await this.requirePublicationEnabled(plugin, publicationId);

    if (hookName !== "onEvent") {
      throw new PluginDomainError("UNKNOWN_PLUGIN_HOOK", "Unsupported plugin hook");
    }
    if (!plugin.capabilities.includes("events.subscribe")) {
      throw new PluginDomainError("PLUGIN_CAPABILITY_DENIED", "Events capability is not declared");
    }
    if (!plugin.hooks.includes("onEvent")) {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_DECLARED", "Event hook is not declared");
    }

    // Tenant boundary: prevent cross-publication access
    if (publicationId && payload && typeof payload === "object") {
      const payloadPubId = (payload as { publicationId?: string }).publicationId;
      if (payloadPubId && payloadPubId !== publicationId) {
        throw new PluginDomainError(
          "CROSS_PUBLICATION_VIOLATION",
          `Cross-publication violation: plugin running in publication '${publicationId}' cannot access data for publication '${payloadPubId}'.`,
        );
      }
    }

    // Policy and tenant scope must be checked before loading/executing plugin code.
    const module = await this.host.loadModule(plugin);
    if (!module || typeof module.onEvent !== "function") {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_FOUND", "Event handler is not exported");
    }

    // Legacy v1 executeHook keeps passing the literal hook name. Named events
    // should be delivered through dispatchEvent(), never parsed from payload.
    await module.onEvent(hookName, payload);
    return { executed: true } as unknown as T;
  }

  /** An explicit named event is never derived from untrusted payload fields. */
  async dispatchEvent(
    pluginId: string,
    eventName: string,
    payload: unknown,
    publicationId?: string,
  ): Promise<void> {
    if (!eventName || eventName === "onEvent") {
      throw new PluginDomainError("INVALID_PLUGIN_EVENT", "A named event is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Plugin is not active");
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    if (!plugin.capabilities.includes("events.subscribe") ||
      (!plugin.hooks.includes(eventName) && !plugin.hooks.includes("onEvent"))) {
      throw new PluginDomainError("PLUGIN_CAPABILITY_DENIED", "Event is not declared");
    }
    if (payload && typeof payload === "object" && "publicationId" in payload) {
      const declared = payload.publicationId;
      if (typeof declared !== "string" || !publicationId || declared !== publicationId) {
        throw new PluginDomainError("CROSS_PUBLICATION_VIOLATION", "Cross-publication violation");
      }
    }
    const module = await this.host.loadModule(plugin);
    if (!module || typeof module.onEvent !== "function") {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_FOUND", "Event handler is not available");
    }
    await module.onEvent(eventName, payload);
  }

  async deactivatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status === "active") {
      try {
        const module = await this.host.loadModule(plugin);
        if (!module) throw new Error("Active plugin module could not be loaded");
        await module.deactivate?.();
      } catch {
        // Fail closed: never claim successful cleanup when it failed.
        await this.pluginRepo.updateStatus(id, "error");
        domainEvents.emit("plugin.deactivation_failed", { pluginId: id, actorId });
        throw new PluginDomainError("PLUGIN_DEACTIVATION_FAILED", "Plugin cleanup failed");
      }
    }
    const deactivated = await this.pluginRepo.updateStatus(id, "inactive");
    domainEvents.emit("plugin.deactivated", { pluginId: id, actorId });
    return deactivated;
  }

  async unregisterPlugin(id: string, actorId: string | null): Promise<void> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (this.publicationStates && await this.publicationStates.hasAnyState(id)) {
      // Keep publication decisions and plugin metadata for safe reactivation.
      // A future explicit purge must be separate, authorized, backed up and audited.
      throw new PluginDomainError(
        "PLUGIN_HAS_PUBLICATIONS", "Disable and review publication installations before uninstall",
      );
    }
    if (plugin.status === "active") {
      throw new PluginDomainError("PLUGIN_ACTIVE", "Deactivate the plugin before uninstalling it");
    }
    await this.pluginRepo.delete(id);
    domainEvents.emit("plugin.unregistered", { pluginId: id, actorId });
  }

  async listPlugins(): Promise<Plugin[]> {
    return this.pluginRepo.list();
  }

  /** Additive Admin projection; global v1 activation remains unchanged. */
  async listPluginsForPublication(publicationId?: string): Promise<
    Array<Plugin & { publicationScoped: boolean; publicationEnabled: boolean }>
  > {
    const plugins = await this.pluginRepo.list();
    return Promise.all(plugins.map(async (plugin) => {
      const publicationScoped = this.host.requiresPublicationEnablement?.(plugin) === true;
      const publicationEnabled = publicationScoped
        ? Boolean(publicationId && plugin.status === "active" &&
            this.publicationStates && await this.publicationStates.isEnabled(plugin.id, publicationId))
        : plugin.status === "active";
      return { ...plugin, publicationScoped, publicationEnabled };
    }));
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    return this.pluginRepo.findById(id);
  }

  /**
   * Enables a globally installed/activated plugin only in the authoritative
   * staff publication. Existing bundled v1 plugins retain global semantics.
   * The caller must have already passed Staff session + plugins.manage.
   */
  async setPublicationEnabled(
    pluginId: string,
    publicationId: string,
    enabled: boolean,
  ): Promise<boolean> {
    if (!publicationId) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (!this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError("PLUGIN_LEGACY_GLOBAL", "Bundled v1 plugins have global activation");
    }
    if (!this.publicationStates) {
      throw new PluginDomainError("PLUGIN_STATE_UNAVAILABLE", "Publication plugin state is unavailable");
    }
    if (enabled && plugin.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Activate the installed plugin before enabling it");
    }
    await this.publicationStates.setEnabled(pluginId, publicationId, enabled);
    domainEvents.emit("plugin.publication_changed", { pluginId, publicationId, enabled });
    return enabled;
  }

  async isPublicationEnabled(pluginId: string, publicationId: string): Promise<boolean> {
    if (!publicationId) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "active") return false;
    if (!this.host.requiresPublicationEnablement?.(plugin)) return true;
    if (!this.publicationStates) return false;
    return this.publicationStates.isEnabled(plugin.id, publicationId);
  }

  private async requirePublicationEnabled(plugin: Plugin, publicationId?: string): Promise<void> {
    if (!this.host.requiresPublicationEnablement?.(plugin)) return;
    if (!publicationId || !this.publicationStates ||
        !(await this.publicationStates.isEnabled(plugin.id, publicationId))) {
      throw new PluginDomainError(
        "PLUGIN_PUBLICATION_INACTIVE", "Plugin is not enabled for this publication",
      );
    }
  }

  // ---------------- Settings ----------------

  /**
   * Declarative settings: non-secret values are stored plainly, secrets are
   * encrypted at rest and replace-only (existing secret values are kept when
   * the incoming value is null/empty).
   */
  async setSettings(
    pluginId: string,
    settings: Record<string, unknown>,
    schema?: Record<string, unknown>,
  ): Promise<void> {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError(
        "PLUGIN_SETTINGS_NOT_SCOPED",
        "External plugin settings require publication-scoped storage",
      );
    }

    const schemaMap = (schema || plugin.settingsSchema || {}) as Record<
      string,
      { type?: string; secret?: boolean }
    >;
    for (const [key, value] of Object.entries(settings)) {
      const isSecret = schemaMap[key]?.secret === true;
      if (isSecret) {
        const current = await this.settingRepo.getSecret(pluginId, key);
        if (value === null || value === "" || value === undefined) {
          // Replace-only: keep existing encrypted secret
          if (current) continue;
          continue;
        }
        await this.settingRepo.set(
          pluginId,
          key,
          null,
          encryptSecret(String(value)),
          true,
        );
      } else {
        await this.settingRepo.set(
          pluginId,
          key,
          value === null || value === undefined ? null : String(value),
          null,
          false,
        );
      }
    }
  }

  async listSettings(
    pluginId: string,
  ): Promise<
    Array<{
      key: string;
      value: string | null;
      isSecret: boolean;
      masked: boolean;
    }>
  > {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError(
        "PLUGIN_SETTINGS_NOT_SCOPED",
        "External plugin settings require publication-scoped storage",
      );
    }
    const settings = await this.settingRepo.listForPlugin(pluginId);
    return settings.map((s) => ({
      key: s.key,
      value: s.isSecret ? "••••••••" : s.value,
      isSecret: s.isSecret,
      masked: s.isSecret,
    }));
  }

  private async loadPlainSettings(
    pluginId: string,
  ): Promise<Record<string, unknown>> {
    const settings = await this.settingRepo.listForPlugin(pluginId);
    const out: Record<string, unknown> = {};
    for (const s of settings) {
      if (s.isSecret) continue; // secrets only via context.getSecret
      if (s.value !== null) out[s.key] = s.value;
    }
    return out;
  }

  private async getDecryptedSecret(
    pluginId: string,
    key: string,
  ): Promise<string | null> {
    const encrypted = await this.settingRepo.getSecret(pluginId, key);
    if (!encrypted) return null;
    try {
      return decryptSecret(encrypted);
    } catch {
      return null;
    }
  }
}
