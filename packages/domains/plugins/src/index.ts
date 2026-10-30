export * from "./domain/plugin";
export * from "./application/plugins-service";
export * from "./application/plugin-storage-migrations";
export { checkOperatorPluginMigrationPlan } from "./application/operator-migration-plan-preflight";
export type { OperatorApprovedMigrationRelease } from "./application/operator-migration-plan-preflight";
export * from "./infrastructure/drizzle-plugin-repositories";
export * from "./infrastructure/drizzle-plugin-storage-migrations";
export * from "./application/plugin-scoped-storage";
export { createHostPluginStorageSession } from "./application/plugin-storage-session";
export { createHostMemberAccessSession } from "./application/plugin-member-access";
export { createHostPluginMemberStorageSession } from "./application/plugin-member-storage-session";

export { TrustedExternalPluginHost, parseTrustedPluginLockfile } from "./application/trusted-external-plugin-host";
export { readTrustedPluginLockfile, readTrustedPluginLockfileWithVerification } from "./application/trusted-release-attestation";
export type { TrustedPluginAttestationOptions } from "./application/trusted-release-attestation";
export { verifyTrustedPluginRelease } from "./application/operator-release-preflight";
export { verifyOperatorReleaseAdmission } from "./application/operator-release-admission";
export type { OperatorReleaseAdmissionReceipt } from "./application/operator-release-admission";
export type { VerifiedExternalRelease } from "./application/operator-release-preflight";
export {
  DrizzlePluginEventLedger, pluginEventLedger, pluginEventJobId,
  pluginEventEnvelopeHash, PluginEventConflictError, PluginEventLedgerError,
} from "./application/plugin-event-ledger";
export type { ClaimedPluginEvent } from "./application/plugin-event-ledger";
export { assertPluginRestoreReadiness } from "./application/plugin-restore-readiness";
export type { RestoreEnabledPlugin, RestorePendingEvent, RestoreReadinessResult } from "./application/plugin-restore-readiness";

export { assessQueueRecovery } from "./application/plugin-queue-recovery";
export type {
  QueueRecoveryReceipt, QueueRecoveryJob, QueueRecoveryState,
} from "./application/plugin-queue-recovery";

export {
  readPluginReceiptDiagnostics, summarizePluginReceiptAges,
} from "./application/plugin-receipt-diagnostics";
export type {
  PluginReceiptDiagnostics, PluginReceiptStateDiagnostic, ActivePluginReceiptStatus,
} from "./application/plugin-receipt-diagnostics";
export { listPluginActivity } from "./application/plugin-activity";
export type { PluginActivityAction, PluginActivityRow, PluginActivityResult } from "./application/plugin-activity";
export { preparePluginUpgradeStage, PluginUpgradePlanError } from "./application/plugin-upgrade-plan";
export type { OperatorUpgradeStageInput, PluginUpgradeStageDetails } from "./application/plugin-upgrade-plan";
export { DrizzlePluginUpgradePlanRepository } from "./infrastructure/drizzle-plugin-upgrade-plans";
export {
  validateOperatorUpgradeAbort,
  validateOperatorUpgradeTransition,
  validateOperatorUpgradeQuiesce,
  validateOperatorUpgradeMigrate,
  validateOperatorUpgradeActivate,
  validateOperatorUpgradeObserve,
  validateOperatorUpgradeComplete,
  validateOperatorUpgradeRollback,
} from "./application/plugin-upgrade-plan";
export type {
  OperatorUpgradeAbortInput,
  OperatorUpgradeTransitionInput,
  OperatorUpgradeQuiesceInput,
  OperatorUpgradeMigrateInput,
  OperatorUpgradeActivateInput,
  OperatorUpgradeObserveInput,
  OperatorUpgradeCompleteInput,
  OperatorUpgradeRollbackInput,
  OperatorUpgradeAuditContext,
} from "./application/plugin-upgrade-plan";
export { validateOperatorUpgradePreflight, validateOperatorUpgradeApproval } from "./application/plugin-upgrade-plan";
export type {
  OperatorUpgradePreflightInput, OperatorUpgradeApprovalInput,
} from "./application/plugin-upgrade-plan";

export * from "./runtime/tier2-ipc";
export * from "./runtime/tier2-capability-gateway";
export * from "./runtime/tier2-process-supervisor";
export * from "./application/plugin-catalog";
export * from "./application/plugin-archive-extractor";
export * from "./application/marketplace-service";



export { DrizzleMarketplaceAdmissionRepository, MarketplaceAdmissionError, parseDurableMarketplaceAdmission, createDurableMarketplaceTier2Supervisor } from "./infrastructure/drizzle-marketplace-admissions";
export type { OperatorMarketplaceReleaseGrant, MarketplaceOperatorAudit } from "./infrastructure/drizzle-marketplace-admissions";
