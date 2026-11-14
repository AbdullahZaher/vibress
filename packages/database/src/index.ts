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
  type RuntimeRoleAttributes,
} from "./platform-runtime-role";
export {
  ApplicationRegistrationDriftError,
  ApplicationRegistrationIntegrityError,
  ApplicationRegistrationMissingError,
  InstallationMismatchError,
  PlatformMembershipResolver,
  PostgresApplicationRegistryStore,
  UnexpectedApplicationRegistrationError,
  type ApplicationRegistrationRecord,
  type InstallationRegistrationRecord,
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

