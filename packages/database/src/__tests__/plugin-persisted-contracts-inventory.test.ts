import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  plugins,
  pluginPublicationStates,
  pluginPublicationSettings,
  pluginSchemaMigrations,
  pluginStorageModels,
} from "../schema/platform";
import { pluginEventReceipts } from "../schema/plugin-events";
import { pluginUpgradePlans } from "../schema/plugin-upgrades";
import { pluginMemberRecords } from "../schema/plugin-member-records";

describe("BASE-05 — Persisted plugin contracts and schema invariants", () => {
  it("verifies plugins catalogue table structure and required fields", () => {
    const cols = getTableColumns(plugins);
    expect(cols.id).toBeDefined();
    expect(cols.manifestId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.version).toBeDefined();
    expect(cols.vibressApiVersion).toBeDefined();
    expect(cols.entrypoint).toBeDefined();
    expect(cols.capabilities).toBeDefined();
    expect(cols.settingsSchema).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("verifies plugin_publication_states publication isolation contract", () => {
    const cols = getTableColumns(pluginPublicationStates);
    expect(cols.pluginId).toBeDefined();
    expect(cols.publicationId).toBeDefined();
    expect(cols.enabled).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("verifies plugin_publication_settings supports scoped encryption and ciphertext", () => {
    const cols = getTableColumns(pluginPublicationSettings);
    expect(cols.id).toBeDefined();
    expect(cols.pluginId).toBeDefined();
    expect(cols.publicationId).toBeDefined();
    expect(cols.key).toBeDefined();
    expect(cols.value).toBeDefined();
    expect(cols.encryptedValue).toBeDefined();
    expect(cols.isSecret).toBeDefined();
  });

  it("verifies plugin_event_receipts at-least-once outbox tracking schema", () => {
    const cols = getTableColumns(pluginEventReceipts);
    expect(cols.id).toBeDefined();
    expect(cols.eventId).toBeDefined();
    expect(cols.pluginId).toBeDefined();
    expect(cols.publicationId).toBeDefined();
    expect(cols.envelopeHash).toBeDefined();
    expect(cols.envelope).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
    expect(cols.finalizedAt).toBeDefined();
  });

  it("verifies plugin_schema_migrations ledger tracks checksums and applied revisions", () => {
    const cols = getTableColumns(pluginSchemaMigrations);
    expect(cols.pluginId).toBeDefined();
    expect(cols.migrationId).toBeDefined();
    expect(cols.packageVersion).toBeDefined();
    expect(cols.artifactSha256).toBeDefined();
    expect(cols.migrationSha256).toBeDefined();
    expect(cols.appliedAt).toBeDefined();
  });

  it("verifies plugin_storage_models tracks model key and schema hashes", () => {
    const cols = getTableColumns(pluginStorageModels);
    expect(cols.pluginId).toBeDefined();
    expect(cols.modelKey).toBeDefined();
    expect(cols.migrationId).toBeDefined();
    expect(cols.schemaSha256).toBeDefined();
  });

  it("verifies plugin_member_records member isolation and CAS fields", () => {
    const cols = getTableColumns(pluginMemberRecords);
    expect(cols.pluginId).toBeDefined();
    expect(cols.publicationId).toBeDefined();
    expect(cols.memberId).toBeDefined();
    expect(cols.modelKey).toBeDefined();
    expect(cols.recordId).toBeDefined();
    expect(cols.version).toBeDefined();
    expect(cols.fields).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("verifies plugin_upgrade_plans durable state machine and approval fields", () => {
    const cols = getTableColumns(pluginUpgradePlans);
    expect(cols.id).toBeDefined();
    expect(cols.pluginId).toBeDefined();
    expect(cols.manifestId).toBeDefined();
    expect(cols.fromVersion).toBeDefined();
    expect(cols.toVersion).toBeDefined();
    expect(cols.fromArtifactSha256).toBeDefined();
    expect(cols.toArtifactSha256).toBeDefined();
    expect(cols.fromLockfileSha256).toBeDefined();
    expect(cols.toLockfileSha256).toBeDefined();
    expect(cols.fromSignerSha256).toBeDefined();
    expect(cols.toSignerSha256).toBeDefined();
    expect(cols.planSha256).toBeDefined();
    expect(cols.preflightSha256).toBeDefined();
    expect(cols.preflightedAt).toBeDefined();
    expect(cols.approvedAt).toBeDefined();
    expect(cols.approvedBy).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.revision).toBeDefined();
  });
});
