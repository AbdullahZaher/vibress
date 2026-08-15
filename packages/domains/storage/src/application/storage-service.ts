import { DrizzleStorageRepository } from "../infrastructure/drizzle-storage-repository";
import {
  StorageConfiguration,
  CreateStorageConfigurationData,
  UpdateStorageConfigurationData,
} from "../domain/storage-config";
import { encryptSecret, decryptSecret } from "@vibress/security";
import { AuditRepository } from "@vibress/audit";
import {
  StorageRegistry,
  defaultStorageRegistry,
  LocalStorageProvider,
  StorageError,
} from "@vibress/storage-core";
import {
  S3StorageProvider,
  S3StorageConfig,
  S3ProviderType,
} from "@vibress/storage-s3";
import { runInTransaction } from "@vibress/database";

export class StorageService {
  constructor(
    private storageRepo: DrizzleStorageRepository,
    private auditRepo: AuditRepository,
    private registry: StorageRegistry = defaultStorageRegistry,
  ) {}

  async listConfigurations(): Promise<StorageConfiguration[]> {
    return this.storageRepo.listConfigurations();
  }

  async getConfigurationById(id: string): Promise<StorageConfiguration | null> {
    return this.storageRepo.findConfigurationById(id);
  }

  async getActiveConfiguration(): Promise<StorageConfiguration | null> {
    return this.storageRepo.findActiveConfiguration();
  }

  async createConfiguration(
    data: CreateStorageConfigurationData,
    actorId: string,
  ): Promise<StorageConfiguration> {
    return runInTransaction(() => this.createConfigurationTx(data, actorId));
  }

  private async createConfigurationTx(
    data: CreateStorageConfigurationData,
    actorId: string,
  ): Promise<StorageConfiguration> {
    let encryptedCredentials: string | null = null;
    if (data.credentials && Object.keys(data.credentials).length > 0) {
      encryptedCredentials = encryptSecret(JSON.stringify(data.credentials));
    }

    const config = await this.storageRepo.createConfiguration({
      ...data,
      encryptedCredentials,
      createdBy: actorId,
    });

    await this.auditRepo.record({
      actorUserId: actorId,
      action: "storage.configuration.created",
      targetType: "storage_configuration",
      targetId: config.id,
      metadata: {
        name: config.name,
        providerType: config.providerType,
        bucket: config.bucket,
      },
    });

    return config;
  }

  async updateConfiguration(
    id: string,
    data: UpdateStorageConfigurationData,
    actorId: string,
  ): Promise<StorageConfiguration> {
    return runInTransaction(() =>
      this.updateConfigurationTx(id, data, actorId),
    );
  }

  private async updateConfigurationTx(
    id: string,
    data: UpdateStorageConfigurationData,
    actorId: string,
  ): Promise<StorageConfiguration> {
    const existing = await this.storageRepo.findConfigurationById(id);
    if (!existing) {
      throw new StorageError(
        `Storage configuration not found: ${id}`,
        "STORAGE_CONFIGURATION_NOT_FOUND",
      );
    }

    let encryptedCredentials = existing.encryptedCredentials;
    if (data.credentials && Object.keys(data.credentials).length > 0) {
      encryptedCredentials = encryptSecret(JSON.stringify(data.credentials));
    }

    const updatePayload: UpdateStorageConfigurationData & {
      encryptedCredentials?: string | null;
    } = {
      ...data,
    };
    if (encryptedCredentials !== undefined) {
      updatePayload.encryptedCredentials = encryptedCredentials;
    }

    const updated = await this.storageRepo.updateConfiguration(
      id,
      updatePayload,
    );

    // If updated config was active, re-activate in registry
    if (updated.isActive) {
      await this.instantiateAndRegisterProvider(updated);
    }

    await this.auditRepo.record({
      actorUserId: actorId,
      action: "storage.configuration.updated",
      targetType: "storage_configuration",
      targetId: updated.id,
      metadata: {
        name: updated.name,
        providerType: updated.providerType,
        credentialsChanged: !!data.credentials,
      },
    });

    return updated;
  }

  async activateConfiguration(
    id: string,
    actorId: string,
  ): Promise<StorageConfiguration> {
    return runInTransaction(() => this.activateConfigurationTx(id, actorId));
  }

  private async activateConfigurationTx(
    id: string,
    actorId: string,
  ): Promise<StorageConfiguration> {
    const config = await this.storageRepo.findConfigurationById(id);
    if (!config) {
      throw new StorageError(
        `Storage configuration not found: ${id}`,
        "STORAGE_CONFIGURATION_NOT_FOUND",
      );
    }

    // Attempt to instantiate and register provider (will throw if credentials/connection invalid)
    const provider = await this.instantiateAndRegisterProvider(config);

    const activated = await this.storageRepo.activateConfiguration(id);

    // Set registry active provider name
    this.registry.setActiveProvider(provider.name);

    await this.auditRepo.record({
      actorUserId: actorId,
      action: "storage.provider.activated",
      targetType: "storage_configuration",
      targetId: activated.id,
      metadata: {
        name: activated.name,
        providerType: activated.providerType,
        providerName: provider.name,
      },
    });

    return activated;
  }

  async deleteConfiguration(id: string, actorId: string): Promise<void> {
    return runInTransaction(() => this.deleteConfigurationTx(id, actorId));
  }

  private async deleteConfigurationTx(
    id: string,
    actorId: string,
  ): Promise<void> {
    const existing = await this.storageRepo.findConfigurationById(id);
    if (!existing) {
      throw new StorageError(
        `Storage configuration not found: ${id}`,
        "STORAGE_CONFIGURATION_NOT_FOUND",
      );
    }
    if (existing.isActive) {
      throw new StorageError(
        "Cannot delete active storage configuration. Activate another configuration first.",
        "STORAGE_PROVIDER_IN_USE",
      );
    }

    await this.storageRepo.deleteConfiguration(id);

    await this.auditRepo.record({
      actorUserId: actorId,
      action: "storage.configuration.deleted",
      targetType: "storage_configuration",
      targetId: id,
      metadata: { name: existing.name },
    });
  }

  async testConnection(
    data: CreateStorageConfigurationData | { id: string },
    actorId: string,
  ): Promise<{ connected: boolean; bucket: string; providerType: string }> {
    let s3Config: S3StorageConfig;

    if ("id" in data && data.id) {
      const existing = await this.storageRepo.findConfigurationById(data.id);
      if (!existing) {
        throw new StorageError(
          `Storage configuration not found: ${data.id}`,
          "STORAGE_CONFIGURATION_NOT_FOUND",
        );
      }
      const creds = this.decryptConfigCredentials(existing);
      s3Config = {
        id: existing.id,
        providerType: existing.providerType as S3ProviderType,
        region: existing.region || "us-east-1",
        bucket: existing.bucket || "",
        forcePathStyle: existing.forcePathStyle,
        accessKeyId: creds.accessKeyId || "",
        secretAccessKey: creds.secretAccessKey || "",
      };
      if (existing.endpoint) s3Config.endpoint = existing.endpoint;
      if (existing.publicBaseUrl)
        s3Config.publicBaseUrl = existing.publicBaseUrl;
    } else {
      const input = data as CreateStorageConfigurationData;
      const creds = input.credentials || {};
      s3Config = {
        providerType: input.providerType as S3ProviderType,
        region: input.region || "us-east-1",
        bucket: input.bucket || "",
        forcePathStyle: input.forcePathStyle,
        accessKeyId: creds.accessKeyId || "",
        secretAccessKey: creds.secretAccessKey || "",
      };
      if (input.endpoint) s3Config.endpoint = input.endpoint;
      if (input.publicBaseUrl) s3Config.publicBaseUrl = input.publicBaseUrl;
    }

    const provider = new S3StorageProvider(s3Config);
    const result = await provider.testConnection();

    await this.auditRepo.record({
      actorUserId: actorId,
      action: "storage.connection.tested",
      targetType: "storage_configuration",
      targetId: s3Config.id || "new",
      metadata: {
        connected: result.connected,
        providerType: result.providerType,
        bucket: result.bucket,
      },
    });

    return result;
  }

  async instantiateAndRegisterProvider(
    config: StorageConfiguration,
  ): Promise<S3StorageProvider | LocalStorageProvider> {
    if (config.providerType === "local") {
      const localProvider = new LocalStorageProvider();
      this.registry.register(localProvider);
      return localProvider;
    }

    const creds = this.decryptConfigCredentials(config);
    const s3Config: S3StorageConfig = {
      id: config.id,
      providerType: config.providerType as S3ProviderType,
      region: config.region || "us-east-1",
      bucket: config.bucket || "",
      forcePathStyle: config.forcePathStyle,
      accessKeyId: creds.accessKeyId || "",
      secretAccessKey: creds.secretAccessKey || "",
    };
    if (config.endpoint) s3Config.endpoint = config.endpoint;
    if (config.publicBaseUrl) s3Config.publicBaseUrl = config.publicBaseUrl;

    const provider = new S3StorageProvider(s3Config);

    // Register both by ID and by provider instance name
    this.registry.register(provider);
    return provider;
  }

  /**
   * Initializes active storage provider at application startup.
   */
  async initializeStartupProvider(): Promise<void> {
    try {
      const activeConfig = await this.getActiveConfiguration();
      if (activeConfig) {
        const provider =
          await this.instantiateAndRegisterProvider(activeConfig);
        this.registry.setActiveProvider(provider.name);
      } else {
        // Fallback to local provider
        const localProvider = new LocalStorageProvider();
        this.registry.register(localProvider);
        this.registry.setActiveProvider(localProvider.name);
      }
    } catch (err: unknown) {
      console.warn(
        "Failed to initialize active storage provider on startup. Falling back to local provider.",
        err,
      );
      const localProvider = new LocalStorageProvider();
      this.registry.register(localProvider);
      this.registry.setActiveProvider(localProvider.name);
    }
  }

  private decryptConfigCredentials(
    config: StorageConfiguration,
  ): Record<string, string> {
    if (!config.encryptedCredentials) return {};
    try {
      const decrypted = decryptSecret(config.encryptedCredentials);
      return JSON.parse(decrypted);
    } catch {
      throw new StorageError(
        "Failed to decrypt storage configuration credentials. Check VIBRESS_ENCRYPTION_KEY.",
        "STORAGE_ENCRYPTION_KEY_MISSING",
      );
    }
  }
}
