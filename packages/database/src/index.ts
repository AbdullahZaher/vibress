import * as schema from "./schema";

export { getDbPool, getDb, closeDbPool } from "./connection";
export { Client, Pool } from "pg";
export { schema };
export * from "./schema";
export { runMigrations } from "./migrate";
export {
  provisionRuntimeRole,
  readRuntimeRoleConfig,
  type RuntimeRoleConfig,
} from "./runtime-role";
export {
  assertSafePlatformRuntimeRole,
  provisionPlatformRuntimeRole,
  readPlatformRuntimeRoleConfig,
  UnsafePlatformRuntimeRoleError,
  type PlatformRuntimeRoleConfig,
  type PlatformRuntimeRoleViolation,
  type PlatformRuntimeRoleViolationCode,
  type PlatformRoleAssertionOptions,
  type PlatformRoleProfile,
  type RuntimeRoleAttributes,
} from "./platform-runtime-role";
export {
  assertSafePlatformMembershipReaderRole,
  provisionPlatformMembershipReaderRole,
  readPlatformMembershipReaderConfig,
  type PlatformMembershipReaderConfig,
} from "./platform-membership-reader";
export {
  assertSafePlatformDeploymentVerifierRole,
  provisionPlatformDeploymentVerifierRole,
  readPlatformDeploymentVerifierConfig,
  type PlatformDeploymentVerifierConfig,
} from "./platform-deployment-verifier";
export {
  assertValidRuntimePrivilegeContract,
  REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
  type PlatformRuntimePrivilegeContract,
  type RuntimeFunctionGrant,
  type RuntimeRelationGrant,
  type RuntimeRelationKind,
  type RuntimeRelationPrivilege,
  type RuntimeSequenceGrant,
  type RuntimeSequencePrivilege,
} from "./platform-runtime-privilege-contract";
export {
  DeploymentVerificationError,
  verifyDeploymentIdentity,
  type VerifiedDeploymentIdentity,
  type VerifyDeploymentIdentityOptions,
} from "./platform-deployment-verification";
export {
  ApplicationRegistrationDriftError,
  ApplicationRegistrationIntegrityError,
  ApplicationRegistrationMissingError,
  InstallationApplicationMissingError,
  InstallationChangeInputError,
  InstallationMismatchError,
  InstallationUpdateRequiredError,
  PlatformMembershipResolver,
  PostgresApplicationRegistryStore,
  RegistryActorRequiredError,
  UnexpectedApplicationRegistrationError,
  type ApplicationRegistrationRecord,
  type InstallationChangeKind,
  type InstallationChangeRecord,
  type InstallationRegistrationInput,
  type InstallationRegistrationRecord,
  type InstallationUpdateInput,
  type RegistryChangeKind,
  type RegistryChangeRecord,
  type RegistryQueryable,
  type RegistrySyncOptions,
  type RegistrySyncOutcome,
  type RegistrySyncResult,
} from "./platform-application-registry";
export { seedDatabase, SYSTEM_ROLES, SYSTEM_PERMISSIONS } from "./seed";
export { seedFixturePost, TARGET_POST_ID } from "./seed-fixture-post";
export * from "./transaction";
export { checkDatabaseSchemaReady, assertDatabaseSchemaReady } from "./schema-safety";
export { eq, and, or, inArray, notInArray, desc, asc, isNull, isNotNull, ilike, sql } from "drizzle-orm";

