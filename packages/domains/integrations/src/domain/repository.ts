import {
  Integration,
  CreateIntegrationData,
  UpdateIntegrationData,
} from "./integration";

export interface IntegrationRepository {
  create(data: CreateIntegrationData): Promise<Integration>;
  findById(id: string): Promise<Integration | null>;
  findByKey(key: string): Promise<Integration | null>;
  update(id: string, data: UpdateIntegrationData): Promise<Integration>;
  list(): Promise<Integration[]>;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  integrationId: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyData {
  id?: string | undefined;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  integrationId?: string | null | undefined;
  expiresAt?: Date | null | undefined;
}

export interface ApiKeyRepository {
  create(data: CreateApiKeyData): Promise<ApiKeyRecord>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<void>;
  touchLastUsed(id: string): Promise<void>;
}
