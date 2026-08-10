import { IntegrationRepository, ApiKeyRepository, ApiKeyRecord } from '../domain/repository';
import { Integration, CreateIntegrationData, UpdateIntegrationData } from '../domain/integration';
import { encryptSecret, decryptSecret, generateOpaqueToken, hashToken } from '@vibress/security';
import { domainEvents } from '@vibress/events';

export class IntegrationDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  prefix: string;
  secret: string;
  scopes: string[];
  expiresAt: Date | null;
}

export interface ApiKeySession {
  keyId: string;
  name: string;
  scopes: string[];
  integrationId: string | null;
}

export class IntegrationsService {
  constructor(
    private integrationRepo: IntegrationRepository,
    private apiKeyRepo: ApiKeyRepository
  ) {}

  // ---------------- Integrations ----------------

  async createIntegration(data: CreateIntegrationData, actorId: string | null): Promise<Integration> {
    const key = data.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      throw new IntegrationDomainError('VALIDATION_ERROR', 'Integration key must be lowercase alphanumeric with hyphens');
    }
    if (!data.name.trim()) throw new IntegrationDomainError('VALIDATION_ERROR', 'Name is required');
    const existing = await this.integrationRepo.findByKey(key);
    if (existing) throw new IntegrationDomainError('VALIDATION_ERROR', 'Integration key already exists');

    const encryptedSecrets = this.encryptSecrets(data.secrets || {});
    const integration = await this.integrationRepo.create({
      ...data,
      key,
      secrets: encryptedSecrets,
    });
    domainEvents.emit('integration.created', { integrationId: integration.id, actorId });
    return integration;
  }

  async updateIntegration(id: string, data: UpdateIntegrationData, actorId: string | null): Promise<Integration> {
    const existing = await this.integrationRepo.findById(id);
    if (!existing) throw new IntegrationDomainError('INTEGRATION_NOT_FOUND', 'Integration not found');

    const updateData: UpdateIntegrationData = { ...data };
    if (data.secrets) {
      // Secrets are replace-only: merge encrypted values onto existing store
      updateData.secrets = {
        ...(existing.encryptedSecrets || {}),
        ...this.encryptSecrets(data.secrets),
      };
    }
    const updated = await this.integrationRepo.update(id, updateData);
    domainEvents.emit('integration.updated', { integrationId: id, actorId });
    return updated;
  }

  async getIntegration(id: string): Promise<Integration | null> {
    return this.integrationRepo.findById(id);
  }

  async listIntegrations(): Promise<Integration[]> {
    return this.integrationRepo.list();
  }

  /**
   * Public-safe DTO: masks all secret values.
   */
  maskIntegration(integration: Integration) {
    const maskedSecrets: Record<string, string> = {};
    if (integration.encryptedSecrets) {
      for (const key of Object.keys(integration.encryptedSecrets)) {
        maskedSecrets[key] = '••••••••';
      }
    }
    return {
      id: integration.id,
      key: integration.key,
      type: integration.type,
      name: integration.name,
      status: integration.status,
      config: integration.config,
      secrets: maskedSecrets,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  async decryptIntegrationSecret(integration: Integration, secretKey: string): Promise<string | null> {
    if (!integration.encryptedSecrets || !integration.encryptedSecrets[secretKey]) return null;
    try {
      return decryptSecret(integration.encryptedSecrets[secretKey]);
    } catch {
      return null;
    }
  }

  private encryptSecrets(secrets: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(secrets)) {
      out[key] = encryptSecret(value);
    }
    return out;
  }

  // ---------------- API Keys ----------------

  /**
   * Creates an API key. The raw secret is returned exactly once.
   */
  async createApiKey(data: { name: string; scopes: string[]; integrationId?: string | null; expiresAt?: Date | null }, actorId: string | null): Promise<ApiKeyCreated> {
    if (!data.name.trim()) throw new IntegrationDomainError('VALIDATION_ERROR', 'Name is required');
    if (!Array.isArray(data.scopes) || data.scopes.length === 0) {
      throw new IntegrationDomainError('VALIDATION_ERROR', 'At least one scope is required');
    }

    const raw = generateOpaqueToken();
    const prefix = `vk_${raw.slice(0, 8)}`;
    const fullSecret = `${prefix}_${raw.slice(8)}`;
    const keyHash = hashToken(fullSecret);

    const record = await this.apiKeyRepo.create({
      name: data.name,
      prefix,
      keyHash,
      scopes: data.scopes,
      integrationId: data.integrationId || null,
      expiresAt: data.expiresAt || null,
    });
    domainEvents.emit('api_key.created', { apiKeyId: record.id, actorId });

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      secret: fullSecret,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
    };
  }

  async listApiKeys(): Promise<ApiKeyRecord[]> {
    return this.apiKeyRepo.list();
  }

  async revokeApiKey(id: string, actorId: string | null): Promise<void> {
    await this.apiKeyRepo.revoke(id);
    domainEvents.emit('api_key.revoked', { apiKeyId: id, actorId });
  }

  /**
   * Resolves a raw bearer secret to a valid API key session, or null.
   * Generic invalid-credential semantics: callers must not distinguish
   * between unknown/expired/revoked keys.
   */
  async authenticateApiKey(rawSecret: string): Promise<ApiKeySession | null> {
    if (!rawSecret || typeof rawSecret !== 'string' || !rawSecret.startsWith('vk_')) return null;
    const keyHash = hashToken(rawSecret);
    const record = await this.apiKeyRepo.findByKeyHash(keyHash);
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

    await this.apiKeyRepo.touchLastUsed(record.id);
    return {
      keyId: record.id,
      name: record.name,
      scopes: record.scopes,
      integrationId: record.integrationId,
    };
  }

  hasScope(session: ApiKeySession, requiredScope: string): boolean {
    return session.scopes.includes(requiredScope);
  }
}
