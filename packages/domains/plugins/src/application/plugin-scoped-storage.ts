/**
 * EXT-203B2: internal host-bound, typed, named storage operations.
 * Host MUST supply scope from an authenticated request / admitted plugin.
 * No SQL connection, tenant selector or mutable scope reaches the plugin SDK.
 */
import type { ApprovedPluginPhysicalModel } from "./plugin-storage-migrations";
import { pluginPhysicalModelDigest } from "./plugin-storage-migrations";

export type PluginStorageFieldValue = string | number | boolean | null;
export interface PluginStorageRecord {
  readonly id: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, PluginStorageFieldValue>>;
}
export interface PluginStoragePage {
  readonly items: readonly PluginStorageRecord[];
  readonly nextCursor?: string;
}
/** Resolved by the trusted host, never request or plugin body fields. */
export interface HostBoundPluginStorageScope {
  readonly pluginId: string;
  readonly publicationId: string;
}
export type PluginStorageAction = "read" | "write";

export interface PluginScopedStorageRepository {
  get(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel, id: string):
    Promise<PluginStorageRecord | null>;
  list(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    limit: number, cursor?: string): Promise<PluginStoragePage>;
  create(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    id: string, fields: Readonly<Record<string, PluginStorageFieldValue>>):
    Promise<PluginStorageRecord>;
  update(scope: HostBoundPluginStorageScope, model: ApprovedPluginPhysicalModel,
    id: string, expectedVersion: number,
    fields: Readonly<Record<string, PluginStorageFieldValue>>):
    Promise<PluginStorageRecord>;
}
export class PluginScopedStorageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PluginScopedStorageError";
  }
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MODEL_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const RESERVED = new Set(["id", "publication_id", "version", "created_at", "updated_at"]);
const FIELD_TYPES = new Set(["text", "integer", "boolean", "timestamptz"]);

function invalid(message: string): never {
  throw new PluginScopedStorageError("PLUGIN_STORAGE_INVALID", message);
}
export function validateStorageRecordId(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid("Invalid storage record identifier");
  }
  return value;
}
export function validateStorageModel(model: ApprovedPluginPhysicalModel): void {
  if (!model || typeof model.key !== "string" || !MODEL_KEY.test(model.key) ||
      !Array.isArray(model.columns) ||
      model.columns.length < 1 || model.columns.length > 24) {
    invalid("Invalid host-approved model descriptor");
  }
  const names = new Set<string>();
  for (const column of model.columns) {
    if (!column || typeof column.name !== "string" ||
        !FIELD_NAME.test(column.name) || RESERVED.has(column.name) ||
        names.has(column.name) || !FIELD_TYPES.has(column.type) ||
        typeof column.required !== "boolean") {
      invalid("Invalid host-approved model field");
    }
    names.add(column.name);
  }
  if (model.schemaSha256 !== pluginPhysicalModelDigest(model.columns)) {
    invalid("Host-approved model digest mismatch");
  }
}
export function validateStorageFields(
  model: ApprovedPluginPhysicalModel, input: unknown, partial: boolean,
): Readonly<Record<string, PluginStorageFieldValue>> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) {
    invalid("Storage fields must be a plain object");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Map(model.columns.map((c) => [c.name, c]));
  const names = Object.keys(value);
  if (names.length === 0 || names.length > model.columns.length) {
    invalid("Storage fields must not be empty or unbounded");
  }
  const result: Record<string, PluginStorageFieldValue> = {};
  for (const name of names) {
    const spec = allowed.get(name);
    if (!spec) invalid("Unknown or protected storage field");
    const entry = value[name];
    if (entry === null && !spec.required) {
      result[name] = null;
      continue;
    }
    const valid = spec.type === "text"
      ? typeof entry === "string" && entry.length <= 8192
      : spec.type === "integer"
        ? typeof entry === "number" && Number.isInteger(entry) &&
          entry >= -2147483648 && entry <= 2147483647
        : spec.type === "boolean"
          ? typeof entry === "boolean"
          : typeof entry === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(entry) &&
            Number.isFinite(Date.parse(entry));
    if (!valid) invalid("Invalid storage field type or value");
    result[name] = entry as PluginStorageFieldValue;
  }
  if (!partial && model.columns.some((col) => col.required && !Object.hasOwn(result, col.name))) {
    invalid("Required storage field is missing");
  }
  return result;
}

/** Validate bounded pagination independently of the service and repository entrypoints. */
export function validateStoragePage(
  limit: number, cursor?: string,
): { limit: number; cursor?: string } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    invalid("Invalid page limit");
  }
  return cursor === undefined
    ? { limit }
    : { limit, cursor: validateStorageRecordId(cursor) };
}

export function validateStorageVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= 2147483647) {
    invalid("Invalid record version");
  }
  return value;
}

/**
 * Bound for one request by the trusted host. The public-facing method
 * signatures never accept pluginId, publicationId, table name or SQL.
 * Enforcement is repeated against locked DB ownership/capability rows in
 * the infrastructure repository on EVERY operation.
 */
export class PluginScopedStorageService {
  private readonly models: ReadonlyMap<string, ApprovedPluginPhysicalModel>;
  constructor(
    private readonly repository: PluginScopedStorageRepository,
    private readonly scope: HostBoundPluginStorageScope,
    approvedModels: readonly ApprovedPluginPhysicalModel[],
  ) {
    validateStorageRecordId(scope.pluginId);
    validateStorageRecordId(scope.publicationId);
    if (!Array.isArray(approvedModels) || approvedModels.length === 0 ||
        approvedModels.length > 16) invalid("Missing approved storage models");
    const models = new Map<string, ApprovedPluginPhysicalModel>();
    for (const model of approvedModels) {
      validateStorageModel(model);
      if (models.has(model.key)) invalid("Duplicate approved storage model");
      models.set(model.key, model);
    }
    this.models = models;
  }
  private model(key: string): ApprovedPluginPhysicalModel {
    const model = this.models.get(key);
    if (!model) throw new PluginScopedStorageError(
      "PLUGIN_STORAGE_MODEL_DENIED", "Model is not registered for this host context",
    );
    return model;
  }
  async get(modelKey: string, id: string): Promise<PluginStorageRecord | null> {
    return this.repository.get(this.scope, this.model(modelKey), validateStorageRecordId(id));
  }
  async list(modelKey: string, limit = 20, cursor?: string): Promise<PluginStoragePage> {
    const page = validateStoragePage(limit, cursor);
    return this.repository.list(this.scope, this.model(modelKey), page.limit, page.cursor);
  }
  async create(modelKey: string, id: string, fields: unknown): Promise<PluginStorageRecord> {
    const model = this.model(modelKey);
    return this.repository.create(this.scope, model, validateStorageRecordId(id),
      validateStorageFields(model, fields, false));
  }
  async update(
    modelKey: string, id: string, expectedVersion: number, patch: unknown,
  ): Promise<PluginStorageRecord> {
    validateStorageVersion(expectedVersion);
    const model = this.model(modelKey);
    return this.repository.update(this.scope, model, validateStorageRecordId(id), expectedVersion,
      validateStorageFields(model, patch, true));
  }
}
