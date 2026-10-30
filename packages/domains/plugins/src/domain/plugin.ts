export type PluginStatus =
  | "registered" | "activating" | "active" | "deactivating" | "inactive" | "error";

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
  create(data: RegisterPluginData, audit?: PluginSettingAuditContext): Promise<Plugin>;
  findById(id: string): Promise<Plugin | null>;
  findByManifestId(manifestId: string): Promise<Plugin | null>;
  updateStatus(
    id: string,
    status: PluginStatus,
    error?: string,
    audit?: PluginSettingAuditContext,
  ): Promise<Plugin>;
  /** Single conditional DB UPDATE prevents concurrent activation/deactivation claims. */
  tryTransitionStatus(
    id: string,
    expected: readonly PluginStatus[],
    status: PluginStatus,
  ): Promise<Plugin | null>;
  updateMetadata(
    id: string,
    data: Partial<RegisterPluginData>,
    audit?: PluginSettingAuditContext,
  ): Promise<Plugin>;
  /**
   * Atomic optimistic concurrency guard for pinned updates. Never overwrite a
   * release if its version, update timestamp or lifecycle state has changed.
   * Optional only for legacy/test adapters; pinned callers fail closed without it.
   */
  tryUpdateMetadataIfInactive?(
    id: string,
    data: Partial<RegisterPluginData>,
    expected: Pick<Plugin, "version" | "updatedAt">,
    audit?: PluginSettingAuditContext,
  ): Promise<Plugin | null>;
  list(): Promise<Plugin[]>;
  delete(id: string): Promise<void>;
  /** Prevent accidental uninstall after a forward-only plugin data migration. */
  hasAppliedMigrations?(id: string): Promise<boolean>;
  /** Explicit, audited purge of all scoped plugin data, schemas, records, and settings. */
  purgePluginData?(id: string, audit: PluginSettingAuditContext): Promise<void>;
}

export interface PluginSettingRepository {
  set(
    pluginId: string,
    key: string,
    value: string | null,
    encryptedValue: string | null,
    isSecret: boolean,
  ): Promise<void>;
  listForPlugin(pluginId: string): Promise<PluginSetting[]>;
  getSecret(pluginId: string, key: string): Promise<string | null>;
}

/** Publication state is explicit for external modules; absent means disabled. */
export interface PluginPublicationStateRepository {
  hasAnyState(pluginId: string): Promise<boolean>;
  isEnabled(pluginId: string, publicationId: string): Promise<boolean>;
  setEnabled(
    pluginId: string, publicationId: string, enabled: boolean,
    audit?: PluginSettingAuditContext,
  ): Promise<void>;
}

/** Publication-scoped settings: legacy plugin_settings is not a fallback. */
/** Operator identity is supplied only by an authenticated Host operation.
 * It never comes from plugin-controlled data or an arbitrary tenant ID. */
export interface PluginSettingAuditContext {
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface PluginPublicationSettingRepository {
  setMany(
    pluginId: string,
    publicationId: string,
    entries: ReadonlyArray<{
      key: string;
      value: string | null;
      encryptedValue: string | null;
      isSecret: boolean;
    }>,
    audit?: PluginSettingAuditContext,
  ): Promise<void>;
  listForPlugin(pluginId: string, publicationId: string): Promise<PluginSetting[]>;
  getSecret(pluginId: string, publicationId: string, key: string): Promise<string | null>;
  /** Optional for test adapters; production adapters atomically audit revocation. */
  deleteSecret?(
    pluginId: string, publicationId: string, key: string,
    audit: PluginSettingAuditContext,
  ): Promise<boolean>;
}
