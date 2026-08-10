export type IntegrationStatus = 'active' | 'disabled';

export interface Integration {
  id: string;
  key: string;
  type: string;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  encryptedSecrets: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIntegrationData {
  id?: string | undefined;
  key: string;
  type: string;
  name: string;
  config?: Record<string, unknown> | undefined;
  secrets?: Record<string, string> | undefined;
}

export interface UpdateIntegrationData {
  name?: string | undefined;
  status?: IntegrationStatus | undefined;
  config?: Record<string, unknown> | undefined;
  secrets?: Record<string, string> | undefined;
}
