import { PluginRepository, PluginSettingRepository, Plugin, PluginSetting, RegisterPluginData, PluginStatus } from '../domain/plugin';
import { validateManifest, PluginManifest, PluginContext, PluginModule } from '@vibress/plugin-sdk';
import { encryptSecret, decryptSecret } from '@vibress/security';
import { domainEvents } from '@vibress/events';

export class PluginDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PluginHost {
  loadModule(plugin: Plugin): Promise<PluginModule | null>;
}

export class PluginsService {
  constructor(
    private pluginRepo: PluginRepository,
    private settingRepo: PluginSettingRepository,
    private host: PluginHost
  ) {}

  /**
   * Discovers/registers a plugin from its manifest. Validation happens
   * before any state is written; incompatible versions and invalid
   * capabilities are rejected.
   */
  async registerPlugin(manifestInput: unknown, actorId: string | null): Promise<Plugin> {
    let manifest: PluginManifest;
    try {
      manifest = validateManifest(manifestInput);
    } catch (err: unknown) {
      throw new PluginDomainError('INVALID_MANIFEST', (err as Error).message || 'Invalid plugin manifest');
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
      domainEvents.emit('plugin.updated', { pluginId: updated.id, actorId });
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
    domainEvents.emit('plugin.registered', { pluginId: plugin.id, actorId });
    return plugin;
  }

  /**
   * Activates a plugin: loads its module via the trusted host and runs
   * activate(). On failure the plugin is marked 'error' — visible but
   * isolated from core functionality.
   */
  async activatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin) throw new PluginDomainError('PLUGIN_NOT_FOUND', 'Plugin not found');

    try {
      const module = await this.host.loadModule(plugin);
      if (!module || typeof module.activate !== 'function') {
        throw new Error('Plugin entrypoint does not export an activate function');
      }
      const settings = await this.loadPlainSettings(plugin.id);
      const context: PluginContext = {
        manifestId: plugin.manifestId,
        name: plugin.name,
        version: plugin.version,
        settings,
        getSecret: (key: string) => this.getDecryptedSecret(plugin.id, key),
        log: (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
          console.log(`[plugin:${plugin.manifestId}] [${level}] ${message}`);
        },
      };
      await module.activate(context);
    } catch (err: unknown) {
      const errMsg = (err as Error).message || 'activation failed';
      await this.pluginRepo.updateStatus(id, 'error');
      domainEvents.emit('plugin.activation_failed', { pluginId: id, error: errMsg });
      throw new PluginDomainError('PLUGIN_ACTIVATION_FAILED', errMsg);
    }

    const activated = await this.pluginRepo.updateStatus(id, 'active');
    domainEvents.emit('plugin.activated', { pluginId: id, actorId });
    return activated;
  }

  async deactivatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin) throw new PluginDomainError('PLUGIN_NOT_FOUND', 'Plugin not found');
    const deactivated = await this.pluginRepo.updateStatus(id, 'inactive');
    domainEvents.emit('plugin.deactivated', { pluginId: id, actorId });
    return deactivated;
  }

  async unregisterPlugin(id: string, actorId: string | null): Promise<void> {
    await this.pluginRepo.delete(id);
    domainEvents.emit('plugin.unregistered', { pluginId: id, actorId });
  }

  async listPlugins(): Promise<Plugin[]> {
    return this.pluginRepo.list();
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    return this.pluginRepo.findById(id);
  }

  // ---------------- Settings ----------------

  /**
   * Declarative settings: non-secret values are stored plainly, secrets are
   * encrypted at rest and replace-only (existing secret values are kept when
   * the incoming value is null/empty).
   */
  async setSettings(pluginId: string, settings: Record<string, unknown>, schema?: Record<string, unknown>): Promise<void> {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError('PLUGIN_NOT_FOUND', 'Plugin not found');

    const schemaMap = (schema || plugin.settingsSchema || {}) as Record<string, { type?: string; secret?: boolean }>;
    for (const [key, value] of Object.entries(settings)) {
      const isSecret = schemaMap[key]?.secret === true;
      if (isSecret) {
        const current = await this.settingRepo.getSecret(pluginId, key);
        if (value === null || value === '' || value === undefined) {
          // Replace-only: keep existing encrypted secret
          if (current) continue;
          continue;
        }
        await this.settingRepo.set(pluginId, key, null, encryptSecret(String(value)), true);
      } else {
        await this.settingRepo.set(pluginId, key, value === null || value === undefined ? null : String(value), null, false);
      }
    }
  }

  async listSettings(pluginId: string): Promise<Array<{ key: string; value: string | null; isSecret: boolean; masked: boolean }>> {
    const settings = await this.settingRepo.listForPlugin(pluginId);
    return settings.map((s) => ({
      key: s.key,
      value: s.isSecret ? '••••••••' : s.value,
      isSecret: s.isSecret,
      masked: s.isSecret,
    }));
  }

  private async loadPlainSettings(pluginId: string): Promise<Record<string, unknown>> {
    const settings = await this.settingRepo.listForPlugin(pluginId);
    const out: Record<string, unknown> = {};
    for (const s of settings) {
      if (s.isSecret) continue; // secrets only via context.getSecret
      if (s.value !== null) out[s.key] = s.value;
    }
    return out;
  }

  private async getDecryptedSecret(pluginId: string, key: string): Promise<string | null> {
    const encrypted = await this.settingRepo.getSecret(pluginId, key);
    if (!encrypted) return null;
    try {
      return decryptSecret(encrypted);
    } catch {
      return null;
    }
  }
}
