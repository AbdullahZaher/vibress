import { describe, it, expect, vi, beforeAll } from 'vitest';
import { IntegrationsService, IntegrationDomainError } from '../src/application/integrations-service';
import { IntegrationRepository, ApiKeyRepository, ApiKeyRecord } from '../src/domain/repository';
import { Integration } from '../src/domain/integration';
import { encryptSecret, decryptSecret } from '@vibress/security';

beforeAll(() => {
  process.env.VIBRESS_ENCRYPTION_KEY = process.env.VIBRESS_ENCRYPTION_KEY || 'test-encryption-key-for-batch-12';
});

function makeIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: 'i1',
    key: 'mailchimp',
    type: 'email-marketing',
    name: 'Mailchimp',
    status: 'active',
    config: {},
    encryptedSecrets: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('IntegrationsService', () => {
  const integrationRepo: IntegrationRepository = {
    create: vi.fn(async (d) => makeIntegration({ key: d.key, type: d.type, name: d.name, encryptedSecrets: d.secrets || null })),
    findById: vi.fn(async () => null),
    findByKey: vi.fn(async () => null),
    update: vi.fn(async (id, d) => makeIntegration({ id, ...d })),
    list: vi.fn(async () => []),
  };
  const apiKeyRepo: ApiKeyRepository = {
    create: vi.fn(async (d) => ({
      id: 'k1', name: d.name, prefix: d.prefix, keyHash: d.keyHash, scopes: d.scopes,
      integrationId: d.integrationId || null, lastUsedAt: null, expiresAt: d.expiresAt || null, revokedAt: null, createdAt: new Date(),
    })),
    findById: vi.fn(async () => null),
    findByKeyHash: vi.fn(async () => null),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => undefined),
    touchLastUsed: vi.fn(async () => undefined),
  };

  function makeService(overrides: Record<string, unknown> = {}) {
    return new IntegrationsService(integrationRepo, apiKeyRepo);
  }

  it('creates an integration with encrypted secrets', async () => {
    const service = makeService();
    const integration = await service.createIntegration({
      key: 'MailChimp', type: 'email', name: 'Mailchimp', secrets: { apiToken: 'super-secret' },
    }, 'u1');
    expect(integration.key).toBe('mailchimp');
    expect(integration.encryptedSecrets).toBeTruthy();
    // Secret is encrypted at rest, not plaintext
    expect(integration.encryptedSecrets!.apiToken).not.toContain('super-secret');
    // Decrypts correctly
    const decrypted = await service.decryptIntegrationSecret(integration, 'apiToken');
    expect(decrypted).toBe('super-secret');
  });

  it('rejects a duplicate integration key', async () => {
    const dupRepo = { ...integrationRepo, findByKey: vi.fn(async () => makeIntegration()) };
    const service = new IntegrationsService(dupRepo, apiKeyRepo);
    await expect(service.createIntegration({ key: 'mailchimp', type: 'x', name: 'X' }, null))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('masks secret values in the public DTO', async () => {
    const service = makeService();
    const integration = makeIntegration({ encryptedSecrets: { apiToken: encryptSecret('abc') } });
    const masked = service.maskIntegration(integration);
    expect(masked.secrets.apiToken).toBe('••••••••');
    expect(JSON.stringify(masked)).not.toContain('abc');
  });

  it('createApiKey returns the raw secret exactly once and stores only a hash', async () => {
    const service = makeService();
    const created = await service.createApiKey({ name: 'CI token', scopes: ['content.read'] }, 'u1');
    expect(created.secret.startsWith('vk_')).toBe(true);
    expect(created.prefix).toBe(created.secret.split('_')[0] + '_' + created.secret.split('_')[1]);

    // The stored record contains only the hash — no raw secret
    const record = apiKeyRepo.create.mock.calls[0][0];
    expect(record.keyHash).not.toContain(created.secret);
    expect(record.keyHash).not.toContain('vk_');
  });

  it('authenticateApiKey resolves a valid key and rejects revoked/expired/unknown', async () => {
    let validHash = '';
    const repo: ApiKeyRepository = {
      ...apiKeyRepo,
      create: vi.fn(async (d) => {
        validHash = d.keyHash;
        return {
          id: 'k1', name: d.name, prefix: d.prefix, keyHash: d.keyHash, scopes: d.scopes,
          integrationId: d.integrationId || null, lastUsedAt: null, expiresAt: d.expiresAt || null, revokedAt: null, createdAt: new Date(),
        };
      }),
      findByKeyHash: vi.fn(async (hash) => {
        if (hash !== validHash) return null;
        return {
          id: 'k1', name: 'CI', prefix: 'vk_abc', keyHash: hash, scopes: ['content.read'],
          integrationId: null, lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: new Date(),
        };
      }),
    };
    const service = new IntegrationsService(integrationRepo, repo);

    const created = await service.createApiKey({ name: 'CI', scopes: ['content.read'] }, null);
    const session = await service.authenticateApiKey(created.secret);
    expect(session).toBeTruthy();
    expect(session!.scopes).toContain('content.read');

    // Unknown key → null
    expect(await service.authenticateApiKey('vk_does_not_exist')).toBeNull();
    // Non-vk format → null
    expect(await service.authenticateApiKey('plain-secret')).toBeNull();
  });

  it('rejects a revoked key with generic null (no distinguishing response)', async () => {
    const repo: ApiKeyRepository = {
      ...apiKeyRepo,
      findByKeyHash: vi.fn(async (hash) => ({
        id: 'k1', name: 'CI', prefix: 'vk_abc', keyHash: hash, scopes: ['content.read'],
        integrationId: null, lastUsedAt: null, expiresAt: null, revokedAt: new Date(), createdAt: new Date(),
      })),
    };
    const service = new IntegrationsService(integrationRepo, repo);
    const created = await service.createApiKey({ name: 'CI', scopes: ['content.read'] }, null);
    expect(await service.authenticateApiKey(created.secret)).toBeNull();
  });

  it('rejects an expired key', async () => {
    const repo: ApiKeyRepository = {
      ...apiKeyRepo,
      findByKeyHash: vi.fn(async (hash) => ({
        id: 'k1', name: 'CI', prefix: 'vk_abc', keyHash: hash, scopes: ['content.read'],
        integrationId: null, lastUsedAt: null, expiresAt: new Date(Date.now() - 1000), revokedAt: null, createdAt: new Date(),
      })),
    };
    const service = new IntegrationsService(integrationRepo, repo);
    const created = await service.createApiKey({ name: 'CI', scopes: ['content.read'] }, null);
    expect(await service.authenticateApiKey(created.secret)).toBeNull();
  });

  it('scope enforcement: hasScope checks membership', async () => {
    const service = makeService();
    const session = { keyId: 'k1', name: 'CI', scopes: ['content.read'], integrationId: null };
    expect(service.hasScope(session, 'content.read')).toBe(true);
    expect(service.hasScope(session, 'admin.navigation')).toBe(false);
  });

  it('secret update is replace-only: existing secrets preserved when not provided', async () => {
    const existing = makeIntegration({ encryptedSecrets: { apiToken: encryptSecret('old-token') } });
    const repo = { ...integrationRepo, findById: vi.fn(async () => existing) };
    const service = new IntegrationsService(repo, apiKeyRepo);
    await service.updateIntegration('i1', { name: 'Renamed' }, 'u1');
    // repo.update called without secrets → encryptedSecrets unchanged in stored object
    const updateCall = repo.update.mock.calls[0][1] as Record<string, unknown>;
    expect(updateCall.secrets).toBeUndefined();
  });
});
