import {
  applicationManifestDigest,
  asApplicationId,
  asInstallationId,
  asPrincipalId,
  asTenantId,
  parseApplicationManifest,
  toApplicationManifest,
  type ApplicationDefinition,
  type ApplicationId,
  type ApplicationManifest,
  type InstallationId,
  type PrincipalId,
  type TenantId,
} from "@vibress/platform-kernel";
import type { MembershipRecord, ScopeResolver } from "@vibress/tenancy";

export interface RegistryQueryable {
  query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

export interface ApplicationRegistrationRecord {
  readonly applicationId: ApplicationId;
  readonly version: string;
  readonly manifest: ApplicationManifest;
  readonly manifestDigest: string;
  readonly registeredAt: Date;
  readonly updatedAt: Date;
}

export interface InstallationRegistrationRecord {
  readonly id: InstallationId;
  readonly applicationId: ApplicationId;
  readonly environment: string;
  readonly artifactDigest: string | null;
  readonly createdAt: Date;
}

export class InstallationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallationMismatchError";
  }
}

export class InstallationApplicationMissingError extends Error {
  constructor(installationId: string, applicationId: string) {
    super(
      `Installation ${installationId} cannot be registered because application '${applicationId}' is not registered`,
    );
    this.name = "InstallationApplicationMissingError";
  }
}

export type RegistrySyncOutcome = "created" | "unchanged" | "updated";

export interface RegistrySyncResult {
  readonly outcome: RegistrySyncOutcome;
  readonly digest: string;
}

export interface RegistrySyncOptions {
  /**
   * Code/manifest drift is refused by default: changing a registered
   * application is a deliberate deployment action.
   */
  readonly allowUpdate?: boolean;
  /**
   * Operator identity recorded in the append-only change audit. Required for
   * `created` and `updated` mutations; an idempotent `unchanged` boot needs no
   * actor because it writes no change record.
   */
  readonly actor?: string;
}

export type RegistryChangeKind = "created" | "updated";

export interface RegistryChangeRecord {
  readonly id: string;
  readonly applicationId: ApplicationId;
  readonly changeKind: RegistryChangeKind;
  readonly actor: string;
  readonly previousDigest: string | null;
  readonly newDigest: string;
  readonly previousVersion: string | null;
  readonly newVersion: string;
  readonly recordedAt: Date;
}

export class RegistryActorRequiredError extends Error {
  constructor() {
    super(
      "Registry mutation requires a non-empty actor (set PLATFORM_REGISTRY_ACTOR or pass options.actor)",
    );
    this.name = "RegistryActorRequiredError";
  }
}

export class ApplicationRegistrationDriftError extends Error {
  readonly applicationId: string;
  readonly registeredDigest: string;
  readonly deployedDigest: string;

  constructor(
    applicationId: string,
    registeredDigest: string,
    deployedDigest: string,
  ) {
    super(
      `Application ${applicationId} is registered with digest ${registeredDigest} but the deployed code has ${deployedDigest}`,
    );
    this.name = "ApplicationRegistrationDriftError";
    this.applicationId = applicationId;
    this.registeredDigest = registeredDigest;
    this.deployedDigest = deployedDigest;
  }
}

export class ApplicationRegistrationMissingError extends Error {
  constructor(applicationId: string) {
    super(`Application ${applicationId} has no persisted registration`);
    this.name = "ApplicationRegistrationMissingError";
  }
}

export class UnexpectedApplicationRegistrationError extends Error {
  constructor(applicationId: string) {
    super(
      `Application ${applicationId} is registered but has no definition in the deployed code`,
    );
    this.name = "UnexpectedApplicationRegistrationError";
  }
}

export class ApplicationRegistrationIntegrityError extends Error {
  constructor(applicationId: string, reason: string) {
    super(`Persisted registration for ${applicationId} is invalid: ${reason}`);
    this.name = "ApplicationRegistrationIntegrityError";
  }
}

interface RegistrationRow {
  application_id: string;
  version: string;
  manifest: unknown;
  manifest_digest: string;
  registered_at: Date;
  updated_at: Date;
}

interface InstallationRow {
  id: string;
  application_id: string;
  environment: string;
  artifact_digest: string | null;
  created_at: Date;
}

interface RegistryChangeRow {
  id: string;
  application_id: string;
  change_kind: string;
  actor: string;
  previous_digest: string | null;
  new_digest: string;
  previous_version: string | null;
  new_version: string;
  recorded_at: Date;
}

function normalizeRegistryActor(value: string | undefined): string | null {
  const actor = value?.trim();
  return actor ? actor : null;
}

/**
 * Persists the serializable manifest of an application and proves at boot that
 * the deployed code still matches it. Handler functions are never persisted.
 */
export class PostgresApplicationRegistryStore {
  readonly #client: RegistryQueryable;

  constructor(client: RegistryQueryable) {
    this.#client = client;
  }

  async sync(
    application: ApplicationDefinition,
    options: RegistrySyncOptions = {},
  ): Promise<RegistrySyncResult> {
    const manifest = toApplicationManifest(application);
    const digest = applicationManifestDigest(manifest);
    const actor = normalizeRegistryActor(options.actor);

    const existing = await this.load(application.id);

    if (existing) {
      if (existing.manifestDigest === digest) {
        await this.#upsertApplicationName(application);
        return { outcome: "unchanged", digest };
      }
      if (!options.allowUpdate) {
        throw new ApplicationRegistrationDriftError(
          application.id,
          existing.manifestDigest,
          digest,
        );
      }
      if (!actor) {
        throw new RegistryActorRequiredError();
      }
      // Concurrency-safe CAS update: only update if the registered digest has
      // not shifted. The audit row is inserted by the same statement, so a
      // committed mutation always has its record.
      const updateResult = await this.#client.query(
        `WITH updated AS (
           UPDATE platform_application_registrations
              SET version = $1,
                  manifest = $2::jsonb,
                  manifest_digest = $3,
                  updated_at = now()
            WHERE application_id = $4 AND manifest_digest = $5
            RETURNING application_id, version, manifest_digest
         ), changed AS (
           INSERT INTO platform_application_registry_changes
             (application_id, change_kind, actor, previous_digest,
              previous_version, new_digest, new_version)
           SELECT application_id, 'updated', $6, $5, $7, manifest_digest, version
             FROM updated
         )
         SELECT application_id FROM updated`,
        [
          application.version,
          JSON.stringify(manifest),
          digest,
          application.id,
          existing.manifestDigest,
          actor,
          existing.version,
        ],
      );
      if (updateResult.rowCount === 0) {
        const reloaded = await this.load(application.id);
        if (reloaded && reloaded.manifestDigest === digest) {
          await this.#upsertApplicationName(application);
          return { outcome: "unchanged", digest };
        }
        throw new ApplicationRegistrationDriftError(
          application.id,
          reloaded?.manifestDigest ?? "unknown",
          digest,
        );
      }
      await this.#upsertApplicationName(application);
      return { outcome: "updated", digest };
    }

    if (!actor) {
      throw new RegistryActorRequiredError();
    }
    // Atomic insert and audit: fail gracefully into reload if another process
    // won the race.
    const insertResult = await this.#client.query(
      `WITH application_row AS (
         INSERT INTO platform_applications (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id
       ), inserted AS (
         INSERT INTO platform_application_registrations
           (application_id, version, manifest, manifest_digest, registered_at, updated_at)
         SELECT application_row.id, $3, $4::jsonb, $5, now(), now()
           FROM application_row
         ON CONFLICT (application_id) DO NOTHING
         RETURNING application_id, version, manifest_digest
       ), changed AS (
         INSERT INTO platform_application_registry_changes
           (application_id, change_kind, actor, previous_digest,
            previous_version, new_digest, new_version)
         SELECT application_id, 'created', $6, NULL, NULL, manifest_digest, version
           FROM inserted
       )
       SELECT application_id FROM inserted`,
      [
        application.id,
        application.name,
        application.version,
        JSON.stringify(manifest),
        digest,
        actor,
      ],
    );

    if (insertResult.rowCount === 0) {
      const concurrent = await this.load(application.id);
      if (!concurrent) {
        throw new ApplicationRegistrationMissingError(application.id);
      }
      if (concurrent.manifestDigest === digest) {
        await this.#upsertApplicationName(application);
        return { outcome: "unchanged", digest };
      }
      throw new ApplicationRegistrationDriftError(
        application.id,
        concurrent.manifestDigest,
        digest,
      );
    }

    return { outcome: "created", digest };
  }

  async #upsertApplicationName(
    application: ApplicationDefinition,
  ): Promise<void> {
    await this.#client.query(
      `INSERT INTO platform_applications (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [application.id, application.name],
    );
  }

  /**
   * Persists and binds an installation record to its application.
   *
   * The application must already be registered (`sync` runs first at boot).
   * Binding is atomic and side-effect-free on rejection: when the installation
   * already belongs to another application the conditional upsert changes no
   * row, so `environment` and `artifact_digest` keep their persisted values and
   * a concurrent conflicting bind cannot overwrite the winner.
   */
  async syncInstallation(installation: {
    readonly id: InstallationId;
    readonly applicationId: ApplicationId;
    readonly environment?: string;
    readonly artifactDigest?: string | null;
    /**
     * Compare-and-swap guard for an operator-driven update. When supplied, an
     * existing installation with a different environment is rejected instead
     * of silently rewritten.
     */
    readonly expectedEnvironment?: string;
    /** Compare-and-swap guard for artifact rotation. */
    readonly expectedArtifactDigest?: string;
  }): Promise<InstallationRegistrationRecord> {
    const environment = installation.environment ?? "production";
    const artifactDigest = installation.artifactDigest ?? null;

    let result;
    try {
      result = await this.#client.query<InstallationRow>(
        `INSERT INTO platform_installations
           (id, application_id, environment, artifact_digest, created_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE
           SET environment = EXCLUDED.environment,
               artifact_digest = COALESCE(EXCLUDED.artifact_digest, platform_installations.artifact_digest)
           WHERE platform_installations.application_id = EXCLUDED.application_id
             AND ($5::text IS NULL OR platform_installations.environment = $5)
             AND ($6::text IS NULL OR platform_installations.artifact_digest = $6)
         RETURNING id, application_id, environment, artifact_digest, created_at`,
        [
          installation.id,
          installation.applicationId,
          environment,
          artifactDigest,
          installation.expectedEnvironment ?? null,
          installation.expectedArtifactDigest ?? null,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new InstallationApplicationMissingError(
          String(installation.id),
          String(installation.applicationId),
        );
      }
      throw error;
    }

    const row = result.rows[0];
    if (row) {
      return parseInstallationRow(row);
    }

    const conflicting = await this.#loadInstallation(installation.id);
    if (!conflicting) {
      throw new Error(
        `Installation ${installation.id} disappeared while being registered`,
      );
    }
    if (conflicting.applicationId !== installation.applicationId) {
      throw new InstallationMismatchError(
        `Installation ${installation.id} is bound to application '${conflicting.applicationId}', but boot requested '${installation.applicationId}'`,
      );
    }
    if (
      installation.expectedEnvironment !== undefined &&
      conflicting.environment !== installation.expectedEnvironment
    ) {
      throw new InstallationMismatchError(
        `Installation ${installation.id} is in environment '${conflicting.environment}', expected '${installation.expectedEnvironment}'`,
      );
    }
    if (
      installation.expectedArtifactDigest !== undefined &&
      conflicting.artifactDigest !== installation.expectedArtifactDigest
    ) {
      throw new InstallationMismatchError(
        `Installation ${installation.id} is pinned to artifact '${conflicting.artifactDigest ?? "none"}', expected '${installation.expectedArtifactDigest}'`,
      );
    }
    return conflicting;
  }

  async #loadInstallation(
    installationId: InstallationId,
  ): Promise<InstallationRegistrationRecord | null> {
    const row = (
      await this.#client.query<InstallationRow>(
        `SELECT id, application_id, environment, artifact_digest, created_at
           FROM platform_installations
          WHERE id = $1`,
        [installationId],
      )
    ).rows[0];
    return row ? parseInstallationRow(row) : null;
  }

  /**
   * Proves that an installation exists and is bound to the expected application.
   */
  async verifyInstallation(
    installationId: InstallationId,
    expectedApplicationId: ApplicationId,
  ): Promise<InstallationRegistrationRecord> {
    const row = (
      await this.#client.query<InstallationRow>(
        `SELECT id, application_id, environment, artifact_digest, created_at
           FROM platform_installations
          WHERE id = $1`,
        [installationId],
      )
    ).rows[0];

    if (!row) {
      throw new Error(`Installation ${installationId} is not registered`);
    }

    if (row.application_id !== expectedApplicationId) {
      throw new InstallationMismatchError(
        `Installation ${installationId} is bound to application '${row.application_id}', expected '${expectedApplicationId}'`,
      );
    }

    return parseInstallationRow(row);
  }

  async load(
    applicationId: ApplicationId | string,
  ): Promise<ApplicationRegistrationRecord | null> {
    const row = (
      await this.#client.query<RegistrationRow>(
        `SELECT application_id, version, manifest, manifest_digest,
                registered_at, updated_at
           FROM platform_application_registrations
          WHERE application_id = $1`,
        [applicationId],
      )
    ).rows[0];
    return row ? parseRegistrationRow(row) : null;
  }

  async list(): Promise<readonly ApplicationRegistrationRecord[]> {
    const rows = (
      await this.#client.query<RegistrationRow>(
        `SELECT application_id, version, manifest, manifest_digest,
                registered_at, updated_at
           FROM platform_application_registrations
          ORDER BY application_id`,
      )
    ).rows;
    return Object.freeze(rows.map(parseRegistrationRow));
  }

  async listChanges(
    applicationId: ApplicationId | string,
  ): Promise<readonly RegistryChangeRecord[]> {
    const rows = (
      await this.#client.query<RegistryChangeRow>(
        `SELECT id, application_id, change_kind, actor, previous_digest,
                new_digest, previous_version, new_version, recorded_at
           FROM platform_application_registry_changes
          WHERE application_id = $1
          ORDER BY recorded_at, id`,
        [applicationId],
      )
    ).rows;
    return Object.freeze(rows.map(parseRegistryChangeRow));
  }

  /**
   * Fails when the persisted registry and the deployed definitions disagree in
   * either direction. Call after `sync` at boot, before serving traffic.
   */
  async verifyDefinitions(
    applications: readonly ApplicationDefinition[],
  ): Promise<void> {
    const persisted = new Map(
      (await this.list()).map((record) => [record.applicationId, record]),
    );
    const deployed = new Set<string>();

    for (const application of applications) {
      deployed.add(application.id);
      const record = persisted.get(application.id);
      if (!record) {
        throw new ApplicationRegistrationMissingError(application.id);
      }
      const digest = applicationManifestDigest(
        toApplicationManifest(application),
      );
      if (record.manifestDigest !== digest) {
        throw new ApplicationRegistrationDriftError(
          application.id,
          record.manifestDigest,
          digest,
        );
      }
    }

    for (const applicationId of persisted.keys()) {
      if (!deployed.has(applicationId)) {
        throw new UnexpectedApplicationRegistrationError(applicationId);
      }
    }
  }
}

function parseInstallationRow(
  row: InstallationRow,
): InstallationRegistrationRecord {
  return {
    id: asInstallationId(row.id),
    applicationId: asApplicationId(row.application_id),
    environment: row.environment,
    artifactDigest: row.artifact_digest,
    createdAt: row.created_at,
  };
}

function parseRegistryChangeRow(
  row: RegistryChangeRow,
): RegistryChangeRecord {
  if (row.change_kind !== "created" && row.change_kind !== "updated") {
    throw new ApplicationRegistrationIntegrityError(
      row.application_id,
      `unknown registry change kind '${row.change_kind}'`,
    );
  }
  return {
    id: row.id,
    applicationId: asApplicationId(row.application_id),
    changeKind: row.change_kind,
    actor: row.actor,
    previousDigest: row.previous_digest,
    newDigest: row.new_digest,
    previousVersion: row.previous_version,
    newVersion: row.new_version,
    recordedAt: row.recorded_at,
  };
}

function parseRegistrationRow(
  row: RegistrationRow,
): ApplicationRegistrationRecord {
  const applicationId = asApplicationId(row.application_id);
  let manifest: ApplicationManifest;
  try {
    manifest = parseApplicationManifest(row.manifest);
  } catch (error) {
    throw new ApplicationRegistrationIntegrityError(
      applicationId,
      error instanceof Error ? error.message : "malformed manifest",
    );
  }
  const recomputed = applicationManifestDigest(manifest);
  if (recomputed !== row.manifest_digest) {
    throw new ApplicationRegistrationIntegrityError(
      applicationId,
      `digest mismatch (stored ${row.manifest_digest}, computed ${recomputed})`,
    );
  }
  return Object.freeze({
    applicationId,
    version: row.version,
    manifest,
    manifestDigest: row.manifest_digest,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  });
}

interface MembershipRow {
  application_id: string;
  tenant_id: string;
  principal_id: string;
  active: boolean;
  roles: string[];
  permissions: string[];
}

/**
 * Resolves principals from the operator-owned membership directory. It must
 * run on a connection with access to `platform_memberships`; the tenant
 * runtime role is intentionally denied that table.
 */
export class PlatformMembershipResolver implements ScopeResolver {
  readonly #client: RegistryQueryable;

  constructor(client: RegistryQueryable) {
    this.#client = client;
  }

  async resolve(
    principalId: PrincipalId,
    applicationId: ApplicationId,
    tenantId: TenantId,
  ): Promise<MembershipRecord | null> {
    const row = (
      await this.#client.query<MembershipRow>(
        `SELECT application_id, tenant_id, principal_id, active, roles, permissions
           FROM platform_memberships
          WHERE application_id = $1 AND tenant_id = $2 AND principal_id = $3`,
        [applicationId, tenantId, principalId],
      )
    ).rows[0];
    if (!row) return null;

    return Object.freeze({
      applicationId: asApplicationId(row.application_id),
      tenantId: asTenantId(row.tenant_id),
      principalId: asPrincipalId(row.principal_id),
      active: row.active,
      roles: Object.freeze([...row.roles]),
      permissions: Object.freeze([...row.permissions]),
    });
  }
}
