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

/**
 * Raised when a create attempted to change an existing installation's
 * environment or artifact. Installation updates are separate, CAS-guarded and
 * audited operations; they are never inferred from a repeated registration.
 */
export class InstallationUpdateRequiredError extends Error {
  constructor(installationId: string) {
    super(
      `Installation ${installationId} already exists with different environment or artifact metadata; use updateInstallation with the expected previous state`,
    );
    this.name = "InstallationUpdateRequiredError";
  }
}

export class InstallationChangeInputError extends Error {
  constructor(message: string) {
    super(`Invalid installation change: ${message}`);
    this.name = "InstallationChangeInputError";
  }
}

export interface InstallationRegistrationInput {
  readonly id: InstallationId;
  readonly applicationId: ApplicationId;
  readonly environment: string;
  readonly artifactDigest: string | null;
  /** Operator identity recorded in the immutable installation audit. */
  readonly actor: string;
  /** Why this installation is being created or changed. */
  readonly reason: string;
  readonly deploymentReference?: string | null;
}

export interface InstallationUpdateInput extends InstallationRegistrationInput {
  /** Exact persisted environment the operator observed before the update. */
  readonly expectedEnvironment: string;
  /**
   * Exact persisted artifact digest before the update. `null` is an explicit
   * expectation that no artifact was pinned; omitting it is rejected.
   */
  readonly expectedArtifactDigest: string | null;
}

export type InstallationChangeKind = "created" | "updated";

export interface InstallationChangeRecord {
  readonly id: string;
  readonly installationId: InstallationId;
  readonly applicationId: ApplicationId;
  readonly changeKind: InstallationChangeKind;
  readonly actor: string;
  readonly reason: string;
  readonly deploymentReference: string | null;
  readonly previousEnvironment: string | null;
  readonly newEnvironment: string;
  readonly previousArtifactDigest: string | null;
  readonly newArtifactDigest: string | null;
  readonly recordedAt: Date;
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

interface InstallationChangeRow {
  id: string;
  installation_id: string;
  application_id: string;
  change_kind: string;
  actor: string;
  reason: string;
  deployment_reference: string | null;
  previous_environment: string | null;
  new_environment: string;
  previous_artifact_digest: string | null;
  new_artifact_digest: string | null;
  recorded_at: Date;
}

function normalizeRegistryActor(value: string | undefined): string | null {
  const actor = value?.trim();
  return actor ? actor : null;
}

function requireChangeText(label: string, value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new InstallationChangeInputError(`${label} is required`);
  }
  return trimmed;
}

function normalizeArtifactDigest(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new InstallationChangeInputError(
      "artifact digest must be null or a non-empty string",
    );
  }
  return trimmed;
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
   * Creates an installation binding. Creation is idempotent when the same
   * application, environment and artifact are already persisted; any other
   * existing state raises {@link InstallationUpdateRequiredError} instead of
   * silently rewriting it.
   *
   * The insert and its immutable audit row are one statement. A conflicting
   * application bind changes no row, so a concurrent loser cannot overwrite
   * the winner.
   */
  async registerInstallation(
    input: InstallationRegistrationInput,
  ): Promise<InstallationRegistrationRecord> {
    const environment = requireChangeText(
      "installation environment",
      input.environment,
    );
    const actor = requireChangeText("installation actor", input.actor);
    const reason = requireChangeText("installation change reason", input.reason);
    const artifactDigest = normalizeArtifactDigest(input.artifactDigest);

    let result;
    try {
      result = await this.#client.query<InstallationRow>(
        `WITH inserted AS (
           INSERT INTO platform_installations
             (id, application_id, environment, artifact_digest, created_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (id) DO NOTHING
           RETURNING id, application_id, environment, artifact_digest, created_at
         ), audited AS (
           INSERT INTO platform_installation_changes
             (installation_id, application_id, change_kind, actor, reason,
              deployment_reference, previous_environment, new_environment,
              previous_artifact_digest, new_artifact_digest)
           SELECT id, application_id, 'created', $5, $6, $7,
                  NULL, environment, NULL, artifact_digest
             FROM inserted
         )
         SELECT * FROM inserted`,
        [
          input.id,
          input.applicationId,
          environment,
          artifactDigest,
          actor,
          reason,
          input.deploymentReference ?? null,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new InstallationApplicationMissingError(
          String(input.id),
          String(input.applicationId),
        );
      }
      throw error;
    }

    const row = result.rows[0];
    if (row) {
      return parseInstallationRow(row);
    }

    const existing = await this.loadInstallation(input.id);
    if (!existing) {
      throw new Error(
        `Installation ${input.id} disappeared while being registered`,
      );
    }
    if (existing.applicationId !== input.applicationId) {
      throw new InstallationMismatchError(
        `Installation ${input.id} is bound to application '${existing.applicationId}', but registration requested '${input.applicationId}'`,
      );
    }
    if (
      existing.environment !== environment ||
      existing.artifactDigest !== artifactDigest
    ) {
      throw new InstallationUpdateRequiredError(String(input.id));
    }
    return existing;
  }

  /**
   * Changes an existing installation under a strict compare-and-swap guard.
   *
   * The update and its audit row are one statement. A missing row, a different
   * application or any divergence from the expected previous environment or
   * artifact changes nothing and raises {@link InstallationMismatchError}.
   */
  async updateInstallation(
    input: InstallationUpdateInput,
  ): Promise<InstallationRegistrationRecord> {
    const environment = requireChangeText(
      "installation environment",
      input.environment,
    );
    const actor = requireChangeText("installation actor", input.actor);
    const reason = requireChangeText("installation change reason", input.reason);
    const artifactDigest = normalizeArtifactDigest(input.artifactDigest);
    const expectedEnvironment = requireChangeText(
      "expected previous environment",
      input.expectedEnvironment,
    );
    if (input.expectedArtifactDigest === undefined) {
      throw new InstallationChangeInputError(
        "expected previous artifact digest is required for an installation update (use null when none is pinned)",
      );
    }
    const expectedArtifactDigest = normalizeArtifactDigest(
      input.expectedArtifactDigest,
    );

    const result = await this.#client.query<InstallationRow>(
      `WITH previous AS (
         SELECT id, environment, artifact_digest
           FROM platform_installations
          WHERE id = $1 AND application_id = $2
       ), updated AS (
         UPDATE platform_installations
            SET environment = $3, artifact_digest = $4
          WHERE id = $1 AND application_id = $2
            AND environment = $5
            AND artifact_digest IS NOT DISTINCT FROM $6
          RETURNING id, application_id, environment, artifact_digest, created_at
       ), audited AS (
         INSERT INTO platform_installation_changes
           (installation_id, application_id, change_kind, actor, reason,
            deployment_reference, previous_environment, new_environment,
            previous_artifact_digest, new_artifact_digest)
         SELECT updated.id, updated.application_id, 'updated', $7, $8, $9,
                previous.environment, updated.environment,
                previous.artifact_digest, updated.artifact_digest
           FROM updated
           JOIN previous ON previous.id = updated.id
       )
       SELECT * FROM updated`,
      [
        input.id,
        input.applicationId,
        environment,
        artifactDigest,
        expectedEnvironment,
        expectedArtifactDigest,
        actor,
        reason,
        input.deploymentReference ?? null,
      ],
    );

    const row = result.rows[0];
    if (row) {
      return parseInstallationRow(row);
    }

    const conflicting = await this.loadInstallation(input.id);
    if (!conflicting) {
      throw new InstallationMismatchError(
        `Installation ${input.id} is not registered`,
      );
    }
    if (conflicting.applicationId !== input.applicationId) {
      throw new InstallationMismatchError(
        `Installation ${input.id} is bound to application '${conflicting.applicationId}', not '${input.applicationId}'`,
      );
    }
    throw new InstallationMismatchError(
      `Installation ${input.id} is in environment '${conflicting.environment}' with artifact '${conflicting.artifactDigest ?? "none"}', expected '${expectedEnvironment}' with artifact '${expectedArtifactDigest ?? "none"}'`,
    );
  }

  async loadInstallation(
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

  async listInstallationChanges(
    installationId: InstallationId,
  ): Promise<readonly InstallationChangeRecord[]> {
    const rows = (
      await this.#client.query<InstallationChangeRow>(
        `SELECT id, installation_id, application_id, change_kind, actor,
                reason, deployment_reference, previous_environment,
                new_environment, previous_artifact_digest, new_artifact_digest,
                recorded_at
           FROM platform_installation_changes
          WHERE installation_id = $1
          ORDER BY recorded_at, id`,
        [installationId],
      )
    ).rows;
    return Object.freeze(rows.map(parseInstallationChangeRow));
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

function parseInstallationChangeRow(
  row: InstallationChangeRow,
): InstallationChangeRecord {
  if (row.change_kind !== "created" && row.change_kind !== "updated") {
    throw new ApplicationRegistrationIntegrityError(
      row.application_id,
      `unknown installation change kind '${row.change_kind}'`,
    );
  }
  return Object.freeze({
    id: row.id,
    installationId: asInstallationId(row.installation_id),
    applicationId: asApplicationId(row.application_id),
    changeKind: row.change_kind,
    actor: row.actor,
    reason: row.reason,
    deploymentReference: row.deployment_reference,
    previousEnvironment: row.previous_environment,
    newEnvironment: row.new_environment,
    previousArtifactDigest: row.previous_artifact_digest,
    newArtifactDigest: row.new_artifact_digest,
    recordedAt: row.recorded_at,
  });
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
