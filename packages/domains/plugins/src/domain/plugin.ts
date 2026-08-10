export type PluginStatus = 'registered' | 'active' | 'inactive' | 'error';

export interface Plugin {
  id: string;
  manifestId: string;
  name: string;
  version: string;
  vibressApiVersion: string;
  description: string | null;
  entrypoint: string;
  capabilities: string[];
  hooks: string[];
  settingsSchema: Record<string, unknown>;
  status: PluginStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterPluginData {
  id?: string | undefined;
  manifestId: string;
  name: string;
  version: string;
  vibressApiVersion: string;
  description?: string | null | undefined;
  entrypoint: string;
  capabilities: string[];
  hooks?: string[] | undefined;
  settingsSchema?: Record<string, unknown> | undefined;
}

export interface PluginSetting {
  id: string;
  pluginId: string;
  key: string;
  value: string | null;
  encryptedValue: string | null;
  isSecret: boolean;
  updatedAt: Date;
  createdAt: Date;
}

export interface PluginRepository {
  create(data: RegisterPluginData): Promise<Plugin>;
  findById(id: string): Promise<Plugin | null>;
  findByManifestId(manifestId: string): Promise<Plugin | null>;
  updateStatus(id: string, status: PluginStatus, error?: string): Promise<Plugin>;
  updateMetadata(id: string, data: Partial<RegisterPluginData>): Promise<Plugin>;
  list(): Promise<Plugin[]>;
  delete(id: string): Promise<void>;
}

export interface PluginSettingRepository {
  set(pluginId: string, key: string, value: string | null, encryptedValue: string | null, isSecret: boolean): Promise<void>;
  listForPlugin(pluginId: string): Promise<PluginSetting[]>;
  getSecret(pluginId: string, key: string): Promise<string | null>;
}
