export type SettingClassification =
  "public" | "staff-visible" | "secret" | "internal";

export type SettingValueType = "string" | "number" | "boolean" | "json";

export interface SettingDefinition {
  key: string;
  type: SettingValueType;
  classification: SettingClassification;
  default?: unknown;
  description?: string;
  validate?: (value: unknown) => string | null;
}

export interface SettingNamespaceDefinition {
  namespace: string;
  settings: SettingDefinition[];
}

export interface SettingRecord {
  id: string;
  namespace: string;
  key: string;
  value: unknown;
  valueType: SettingValueType;
  classification: SettingClassification;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface SettingRepository {
  get(namespace: string, key: string): Promise<SettingRecord | null>;
  getMany(namespace: string): Promise<SettingRecord[]>;
  set(record: {
    namespace: string;
    key: string;
    value: unknown;
    valueType: SettingValueType;
    classification: SettingClassification;
    updatedBy: string | null;
  }): Promise<SettingRecord>;
  delete(namespace: string, key: string): Promise<void>;
}

export interface AuditRecorder {
  record(data: {
    actorUserId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}
