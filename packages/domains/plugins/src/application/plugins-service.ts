import {
  PluginRepository,
  PluginSettingRepository,
  Plugin,
  PluginStatus,
  PluginPublicationStateRepository,
  PluginPublicationSettingRepository,
  type PluginSettingAuditContext,
} from "../domain/plugin";
import {
  validateManifest,
  SDK_VERSION,
  PluginManifest,
  PluginContext,
  PluginModule,
} from "@vibress/plugin-sdk";
import { encryptSecret, decryptSecret } from "@vibress/security";
import { domainEvents } from "@vibress/events";
import { isDeepStrictEqual } from "node:util";
import type { ApprovedPluginPhysicalModel } from "./plugin-storage-migrations";
import { validateStorageModel } from "./plugin-scoped-storage";

export class PluginDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Host-owned, read-only release projection: no operator file paths or URLs. */
export interface OperatorTrustedReleaseSummary {
  readonly releaseId: string;
  readonly publisher: { readonly id: string; readonly name: string };
  readonly artifactSha256: string;
  readonly compatibility: {
    readonly minVibressApiVersion: string;
    readonly maxVibressApiVersion: string;
    readonly sdkAbiVersion: string;
  };
  readonly hasSbom: boolean;
  readonly hasProvenance: boolean;
  readonly migrationPlanIds: readonly string[];
}

export interface PluginHost {
  /** Optional release identity checked again immediately before ESM evaluation. */
  loadModule(plugin: Plugin, expectedReleaseKey?: string): Promise<PluginModule | null>;
  requiresPublicationEnablement?(plugin: Plugin): boolean;
  getOperatorManifests?(): Promise<PluginManifest[]>;
  /** Operator-owned approval metadata; never accepted from an HTTP caller. */
  getOperatorManifestCatalog?(): Promise<Array<{
    manifest: PluginManifest;
    signatureVerified: boolean;
    approvalId?: string;
    release?: OperatorTrustedReleaseSummary;
  }>>;
  /** Admission is rechecked immediately before changing registered metadata. */
  verifyOperatorRegistration?(): Promise<void>;
  /** Operator-pinned digest identities for caching static Admin descriptors only. */
  getOperatorAdminFingerprints?(): Promise<ReadonlyMap<string, string>>;
  /** Optional approved file reader; returns inert bytes, never executable plugin code. */
  readApprovedAdminUiAsset?(plugin: Plugin, viewId: string): Promise<string | null>;
  authorizeRegistration?(manifest: PluginManifest, expectedReleaseId?: string): Promise<void>;
  /** Operator-owned lockfile only; descriptors are NOT accepted from plugins. */
  getApprovedStorageModels?(plugin: Plugin): Promise<readonly ApprovedPluginPhysicalModel[]>;
  getApprovedAudienceReadModels?(plugin: Plugin, audience: "public" | "member"): Promise<readonly string[] | null>;
}

/** Lifecycle error text must be platform-owned, never obtained from plugin code. */
const lifecycleMessages: Readonly<Record<string, string>> = {
  PLUGIN_RESTART_REQUIRED: "Plugin release changed; restart this runtime",
  PLUGIN_LOCKFILE_UNAVAILABLE: "Trusted operator lockfile is unavailable",
  PLUGIN_NOT_TRUSTED: "Plugin release is not operator approved",
  PLUGIN_RELEASE_NOT_APPROVED: "Operator approval is unavailable for this release",
  PLUGIN_MODULE_NOT_FOUND: "Plugin module could not be loaded",
  PLUGIN_ENTRYPOINT_INVALID: "Plugin entrypoint is invalid",
  PLUGIN_MANIFEST_MISMATCH: "Registered plugin metadata differs from the trusted operator lockfile",
  PLUGIN_CHECKSUM_MISMATCH: "Trusted plugin checksum mismatch",
  PLUGIN_PATH_ESCAPES_ROOT: "Trusted plugin path escapes its approved directory",
  PLUGIN_FILE_INVALID: "Trusted plugin file is invalid",
  PLUGIN_SIZE_LIMIT_EXCEEDED: "Trusted plugin file exceeds its size limit",
};
function safeLifecycleFailure(err: unknown, fallback: "PLUGIN_ACTIVATION_FAILED" | "PLUGIN_DEACTIVATION_FAILED"): PluginDomainError {
  if (err instanceof PluginDomainError && Object.hasOwn(lifecycleMessages, err.code)) {
    return new PluginDomainError(err.code, lifecycleMessages[err.code]!);
  }
  return new PluginDomainError(fallback,
    fallback === "PLUGIN_ACTIVATION_FAILED" ? "Plugin activation failed" : "Plugin cleanup failed");
}

export class PluginsService {
  constructor(
    private pluginRepo: PluginRepository,
    private settingRepo: PluginSettingRepository,
    private host: PluginHost,
    private publicationStates?: PluginPublicationStateRepository,
    private publicationSettings?: PluginPublicationSettingRepository,
  ) {}

  /** An API replica initializes a module locally before its first event. */
  private readonly initializedHere = new Map<string, Promise<void>>();
  private readonly activeInstances = new Map<string, { plugin: Plugin; module: PluginModule }>();
  // A running replica must not treat different approved bytes as the same
  // already-initialized release, even when the operator reuses a semver label.
  private readonly localReleaseKeys = new Map<string, string>();

  /** A maintenance-only replica never runs plugin event handlers or lifecycle hooks. */
  private get recoveryMaintenance(): boolean {
    return process.env.VIBRESS_PLUGIN_RECOVERY_MAINTENANCE === "1";
  }

  private assertRuntimeAllowed(): void {
    if (this.recoveryMaintenance) {
      throw new PluginDomainError(
        "PLUGIN_RECOVERY_MAINTENANCE",
        "Plugin execution is disabled in recovery maintenance mode",
      );
    }
  }

  private async activationKey(plugin: Plugin): Promise<string> {
    const isExternal = this.host.requiresPublicationEnablement?.(plugin) === true;
    const fingerprints = isExternal
      ? await this.host.getOperatorAdminFingerprints?.()
      : undefined;
    const digest = fingerprints?.get(plugin.manifestId);
    if (isExternal && this.host.getOperatorAdminFingerprints && !digest) {
      throw new PluginDomainError(
        "PLUGIN_RELEASE_NOT_APPROVED", "Operator approval is unavailable for this release",
      );
    }
    return JSON.stringify([plugin.id, plugin.version, plugin.entrypoint, digest ?? "bundled"]);
  }

  private assertLocalRelease(plugin: Plugin, releaseKey: string): void {
    const prior = this.localReleaseKeys.get(plugin.id);
    if (prior && prior !== releaseKey) {
      // Old module instances may retain settings/timers. Never mix them with
      // a replacement under the same process. Quiesce and restart replicas.
      throw new PluginDomainError(
        "PLUGIN_RESTART_REQUIRED", "Plugin release changed; restart this runtime",
      );
    }
    this.localReleaseKeys.set(plugin.id, releaseKey);
  }

  /** A queued or in-flight event cannot inherit a replacement package or
   * capabilities after local initialization. Compare the complete immutable
   * admission snapshot, not just the plugin's status. */
  private sameExecutionRelease(snapshot: Plugin, current: Plugin): boolean {
    return current.status === "active" &&
      current.id === snapshot.id &&
      current.manifestId === snapshot.manifestId &&
      current.version === snapshot.version &&
      current.entrypoint === snapshot.entrypoint &&
      current.vibressApiVersion === snapshot.vibressApiVersion &&
      isDeepStrictEqual(current.capabilities, snapshot.capabilities) &&
      isDeepStrictEqual(current.hooks, snapshot.hooks) &&
      isDeepStrictEqual(current.settingsSchema, snapshot.settingsSchema);
  }

  private async activationContext(plugin: Plugin): Promise<PluginContext> {
    const publicationScoped = this.host.requiresPublicationEnablement?.(plugin) === true;
    const settings = publicationScoped ? {} : await this.loadPlainSettings(plugin.id);
    return {
      manifestId: plugin.manifestId,
      name: plugin.name,
      version: plugin.version,
      publicationId: undefined,
      settings,
      getSecret: publicationScoped
        ? async (_key: string) => null
        : (key: string) => this.getDecryptedSecret(plugin.id, key),
      log: (message: string, level: "info" | "warn" | "error" = "info") => {
        console.log(`[plugin:${plugin.manifestId}] [${level}] ${message}`);
      },
      hasCapability: (capability: string) => plugin.capabilities.includes(capability),
    };
  }

  private async ensureInitializedHere(plugin: Plugin, module: PluginModule): Promise<void> {
    const key = await this.activationKey(plugin);
    this.assertLocalRelease(plugin, key);
    let pending = this.initializedHere.get(key);
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        await module.activate(await this.activationContext(plugin));
        this.activeInstances.set(key, { plugin, module });
      });
      this.initializedHere.set(key, pending);
    }
    try {
      await pending;
    } catch {
      if (this.initializedHere.get(key) === pending) {
        this.initializedHere.delete(key);
        this.activeInstances.delete(key);
      }
      throw new PluginDomainError(
        "PLUGIN_LOCAL_INITIALIZATION_FAILED", "Plugin initialization failed in this API replica",
      );
    }
  }

  /**
   * Discovers/registers a plugin from its manifest. Validation happens
   * before any state is written; incompatible versions and invalid
   * capabilities are rejected.
   */
  async registerPlugin(
    manifestInput: unknown,
    actorId: string | null,
    expectedReleaseId?: string,
  ): Promise<Plugin> {
    let manifest: PluginManifest;
    try {
      manifest = validateManifest(manifestInput);
    } catch (err: unknown) {
      throw new PluginDomainError(
        "INVALID_MANIFEST",
        (err as Error).message || "Invalid plugin manifest",
      );
    }

    try {
      await this.host.authorizeRegistration?.(manifest, expectedReleaseId);
    } catch {
      throw new PluginDomainError(
        "PLUGIN_NOT_TRUSTED", "Plugin manifest is not approved by the operator",
      );
    }

    const existing = await this.pluginRepo.findByManifestId(manifest.id);
    if (existing) {
      if (existing.status === "activating" || existing.status === "deactivating") {
        throw new PluginDomainError(
          "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
        );
      }
      // Even a same-version digest swap must not be registered while an old
      // module is active. Persisted v1 rows do not store the artifact digest.
      if (expectedReleaseId !== undefined && existing.status === "active") {
        throw new PluginDomainError(
          "PLUGIN_UPDATE_REQUIRES_DEACTIVATION",
          "Deactivate the external plugin before registering an updated release",
        );
      }
      // An external code/version change must never bypass deactivate/activate.
      if (this.host.requiresPublicationEnablement?.(existing) === true) {
        const newSchema = manifest.settingsSchema ?? {};
        const oldFields = this.getSettingDefinitions(existing.settingsSchema);
        const newFields = this.getSettingDefinitions(newSchema);
        // Existing setting keys are immutable without a reviewed data migration.
        // In particular, plaintext settings must never silently become secrets.
        for (const [key, definition] of Object.entries(oldFields)) {
          if (!Object.hasOwn(newFields, key) ||
              !isDeepStrictEqual(definition, newFields[key])) {
            throw new PluginDomainError(
              "PLUGIN_SETTINGS_SCHEMA_MIGRATION_REQUIRED",
              "Changing an existing plugin setting requires a reviewed migration",
            );
          }
        }
        if (existing.status === "active" &&
            (existing.name !== manifest.name ||
              existing.description !== (manifest.description ?? null) ||
              existing.version !== manifest.version ||
              existing.entrypoint !== manifest.entrypoint ||
              existing.vibressApiVersion !== manifest.vibressApiVersion ||
              !isDeepStrictEqual(existing.capabilities, manifest.capabilities) ||
              !isDeepStrictEqual(existing.hooks, manifest.hooks ?? []) ||
              !isDeepStrictEqual(existing.settingsSchema, newSchema))) {
          throw new PluginDomainError(
            "PLUGIN_UPDATE_REQUIRES_DEACTIVATION",
            "Deactivate the external plugin before registering a changed release",
          );
        }
      }
      // Update metadata (re-registration). Pinned external upgrades need a
      // DB-atomic status guard so simultaneous activation cannot race the write.
      const metadata = {
        name: manifest.name,
        version: manifest.version,
        vibressApiVersion: manifest.vibressApiVersion,
        description: manifest.description || null,
        entrypoint: manifest.entrypoint,
        capabilities: manifest.capabilities,
        hooks: manifest.hooks || [],
        settingsSchema: manifest.settingsSchema,
      };
      let updated: Plugin | null;
      if (expectedReleaseId !== undefined &&
          this.host.requiresPublicationEnablement?.(existing) === true) {
        updated = await this.pluginRepo.tryUpdateMetadataIfInactive?.(existing.id, metadata) ?? null;
        if (!updated) {
          throw new PluginDomainError("PLUGIN_TRANSITION_IN_PROGRESS",
            "Plugin activated or changed during release admission");
        }
      } else {
        updated = await this.pluginRepo.updateMetadata(existing.id, metadata);
      }
      domainEvents.emit("plugin.updated", { pluginId: updated.id, actorId });
      return updated;
    }

    const plugin = await this.pluginRepo.create({
      manifestId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      vibressApiVersion: manifest.vibressApiVersion,
      description: manifest.description || null,
      entrypoint: manifest.entrypoint,
      capabilities: manifest.capabilities,
      hooks: manifest.hooks || [],
      settingsSchema: manifest.settingsSchema,
    });
    domainEvents.emit("plugin.registered", { pluginId: plugin.id, actorId });
    return plugin;
  }

  /**
   * Activates a plugin: loads its module via the trusted host and runs
   * activate(). On failure the plugin is marked 'error' — visible but
   * reported as a domain error. In-process crashes are NOT isolated.
   */
  async activatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    this.assertRuntimeAllowed();
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");

    if (plugin.vibressApiVersion !== SDK_VERSION) {
      throw new PluginDomainError("PLUGIN_INCOMPATIBLE_API_VERSION",
        "Plugin Host API version is incompatible; operator-approved upgrade required");
    }
    if (plugin.status === "active") return plugin;
    if (plugin.status === "activating" || plugin.status === "deactivating") {
      throw new PluginDomainError(
        "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
      );
    }
    const claimed = await this.pluginRepo.tryTransitionStatus(
      id, ["registered", "inactive", "error"], "activating",
    );
    if (!claimed) {
      const latest = await this.pluginRepo.findById(id);
      if (latest?.status === "active") return latest;
      throw new PluginDomainError(
        "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
      );
    }

    try {
      // Importing ESM runs its top-level code. Reject an incompatible local
      // release before calling loadModule, not after importing the replacement.
      const key = await this.activationKey(claimed);
      this.assertLocalRelease(claimed, key);
      // The host checks the same key against the signed lockfile at the import
      // boundary, protecting against an approval change during this operation.
      const module = await this.host.loadModule(claimed, key);
      if (!module) {
        const isExternal = this.host.requiresPublicationEnablement?.(claimed) === true;
        if (isExternal) {
          throw new PluginDomainError(
            "PLUGIN_LOCKFILE_UNAVAILABLE",
            "Trusted operator lockfile path is not configured (VIBRESS_TRUSTED_PLUGIN_LOCKFILE is not set)",
          );
        }
        throw new PluginDomainError(
          "PLUGIN_MODULE_NOT_FOUND",
          "Plugin module could not be loaded",
        );
      }
      if (typeof module.activate !== "function") {
        throw new PluginDomainError(
          "PLUGIN_ENTRYPOINT_INVALID",
          "Plugin entrypoint does not export an activate function",
        );
      }
      await module.activate(await this.activationContext(claimed));
      this.initializedHere.set(key, Promise.resolve());
      this.activeInstances.set(key, { plugin: claimed, module });
    } catch (err: unknown) {
      const safeError = safeLifecycleFailure(err, "PLUGIN_ACTIVATION_FAILED");
      console.warn(
        `[plugins] Plugin activation failed: manifestId=${claimed.manifestId} pluginId=${id} code=${safeError.code}`,
      );
      // Clean up any partial local state on activation failure
      const localKey = this.localReleaseKeys.get(id);
      if (localKey) {
        this.initializedHere.delete(localKey);
        this.activeInstances.delete(localKey);
      }
      // Plugin exceptions and filesystem errors may include tokens or operator
      // paths. Never forward those raw messages to callers or domain events.
      await this.pluginRepo.updateStatus(id, "error");
      domainEvents.emit("plugin.activation_failed", {
        pluginId: id,
        error: "Plugin activation failed",
      });
      throw safeError;
    }

    const activated = await this.pluginRepo.updateStatus(id, "active");
    domainEvents.emit("plugin.activated", { pluginId: id, actorId });
    return activated;
  }

  /**
   * Executes a plugin hook across active plugins with publication scoping and capability check.
   */
  async executeHook<T = unknown>(
    pluginId: string,
    hookName: string,
    payload: unknown,
    publicationId?: string,
  ): Promise<T> {
    this.assertRuntimeAllowed();
    const plugin = await this.pluginRepo.findById(pluginId);

    if (!plugin) {
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    }
    if (plugin.status !== "active") {
      throw new PluginDomainError(
        "PLUGIN_INACTIVE",
        `Plugin '${plugin.manifestId}' is ${plugin.status}. Only active plugins can process hooks.`,
      );
    }
    await this.requirePublicationEnabled(plugin, publicationId);

    if (hookName !== "onEvent") {
      throw new PluginDomainError("UNKNOWN_PLUGIN_HOOK", "Unsupported plugin hook");
    }
    if (!plugin.capabilities.includes("events.subscribe")) {
      throw new PluginDomainError("PLUGIN_CAPABILITY_DENIED", "Events capability is not declared");
    }
    if (!plugin.hooks.includes("onEvent")) {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_DECLARED", "Event hook is not declared");
    }

    // Tenant boundary: prevent cross-publication access
    if (publicationId && payload && typeof payload === "object") {
      const payloadPubId = (payload as { publicationId?: string }).publicationId;
      if (payloadPubId && payloadPubId !== publicationId) {
        throw new PluginDomainError(
          "CROSS_PUBLICATION_VIOLATION",
          `Cross-publication violation: plugin running in publication '${publicationId}' cannot access data for publication '${payloadPubId}'.`,
        );
      }
    }

    // Policy and tenant scope must be checked before loading/executing plugin code.
    const module = await this.host.loadModule(plugin);
    if (!module || typeof module.onEvent !== "function") {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_FOUND", "Event handler is not exported");
    }

    await this.ensureInitializedHere(plugin, module);
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Plugin became inactive during initialization");
    }
    if (!this.sameExecutionRelease(plugin, latest)) {
      throw new PluginDomainError(
        "PLUGIN_RELEASE_CHANGED",
        "Plugin release or authorization changed during event admission",
      );
    }
    await this.requirePublicationEnabled(latest, publicationId);
    // Legacy v1 executeHook keeps passing the literal hook name. Named events
    // should be delivered through dispatchEvent(), never parsed from payload.
    await module.onEvent(hookName, payload);
    return { executed: true } as unknown as T;
  }

  /** An explicit named event is never derived from untrusted payload fields. */
  async dispatchEvent(
    pluginId: string,
    eventName: string,
    payload: unknown,
    publicationId?: string,
  ): Promise<void> {
    this.assertRuntimeAllowed();
    if (!eventName || eventName === "onEvent") {
      throw new PluginDomainError("INVALID_PLUGIN_EVENT", "A named event is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Plugin is not active");
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    if (!plugin.capabilities.includes("events.subscribe") ||
      (!plugin.hooks.includes(eventName) && !plugin.hooks.includes("onEvent"))) {
      throw new PluginDomainError("PLUGIN_CAPABILITY_DENIED", "Event is not declared");
    }
    if (payload && typeof payload === "object" && "publicationId" in payload) {
      const declared = payload.publicationId;
      if (typeof declared !== "string" || !publicationId || declared !== publicationId) {
        throw new PluginDomainError("CROSS_PUBLICATION_VIOLATION", "Cross-publication violation");
      }
    }
    const module = await this.host.loadModule(plugin);
    if (!module || typeof module.onEvent !== "function") {
      throw new PluginDomainError("PLUGIN_HOOK_NOT_FOUND", "Event handler is not available");
    }
    const scoped = this.host.requiresPublicationEnablement?.(plugin) === true;
    // A retained secret reader must retain the identity of the admitted
    // operator-signed artifact, not just the public semver/entrypoint.
    const admittedReleaseKey = scoped ? await this.activationKey(plugin) : undefined;
    let context: PluginContext | undefined;
    if (scoped) {
      if (!publicationId) {
        throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication is required");
      }
      const scopedSettings = plugin.capabilities.includes("settings.read-own")
        ? await this.loadPublicationSettings(plugin.id, publicationId)
        : {};
      context = {
        manifestId: plugin.manifestId,
        name: plugin.name,
        version: plugin.version,
        publicationId,
        settings: scopedSettings,
        getSecret: (key: string) =>
          plugin.capabilities.includes("settings.read-own")
            ? this.getPublicationSecret(plugin.id, publicationId, key, admittedReleaseKey)
            : Promise.resolve(null),
        log: (message: string, level: "info" | "warn" | "error" = "info") => {
          console.log(`[plugin:${plugin.manifestId}] [${level}] ${message}`);
        },
        hasCapability: (capability: string) => plugin.capabilities.includes(capability),
      };
    }
    await this.ensureInitializedHere(plugin, module);
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Plugin became inactive during initialization");
    }
    if (!this.sameExecutionRelease(plugin, latest)) {
      throw new PluginDomainError(
        "PLUGIN_RELEASE_CHANGED",
        "Plugin release or authorization changed during event admission",
      );
    }
    await this.requirePublicationEnabled(latest, publicationId);
    await module.onEvent(eventName, payload, context);
  }

  async deactivatePlugin(id: string, actorId: string | null): Promise<Plugin> {
    this.assertRuntimeAllowed();
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status === "inactive") return plugin;
    if (plugin.status === "activating" || plugin.status === "deactivating") {
      throw new PluginDomainError(
        "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
      );
    }
    if (plugin.status === "active") {
      // Deactivation must clean up the very same approved module initialized
      // in this process, never a hot-swapped artifact under the same semver.
      if (this.localReleaseKeys.has(plugin.id)) {
        this.assertLocalRelease(plugin, await this.activationKey(plugin));
      }
      const claimed = await this.pluginRepo.tryTransitionStatus(
        id, ["active"], "deactivating",
      );
      if (!claimed) {
        const latest = await this.pluginRepo.findById(id);
        if (latest?.status === "inactive") return latest;
        throw new PluginDomainError(
          "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
        );
      }
      try {
        const localKey = this.localReleaseKeys.get(id);
        const existing = localKey ? this.activeInstances.get(localKey) : undefined;
        const module = existing?.module ?? (await this.host.loadModule(claimed));
        if (!module) {
          throw new PluginDomainError(
            "PLUGIN_MODULE_NOT_FOUND",
            "Active plugin module could not be loaded",
          );
        }
        await module.deactivate?.();
      } catch (err: unknown) {
        // Fail closed: never claim successful cleanup when it failed.
        await this.pluginRepo.updateStatus(id, "error");
        domainEvents.emit("plugin.deactivation_failed", { pluginId: id, actorId });
        throw safeLifecycleFailure(err, "PLUGIN_DEACTIVATION_FAILED");
      }
    } else {
      const claimed = await this.pluginRepo.tryTransitionStatus(
        id, ["registered", "error"], "deactivating",
      );
      if (!claimed) {
        throw new PluginDomainError(
          "PLUGIN_TRANSITION_IN_PROGRESS", "A plugin lifecycle operation is in progress",
        );
      }
    }
    const deactivated = await this.pluginRepo.updateStatus(id, "inactive");
    const localKey = this.localReleaseKeys.get(id);
    if (localKey) this.initializedHere.delete(localKey);
    for (const [key, instance] of this.activeInstances) {
      if (instance.plugin.id === id) {
        this.initializedHere.delete(key);
        this.activeInstances.delete(key);
      }
    }
    // Note: Do NOT delete this.localReleaseKeys.get(id).
    // Requirement 3: Preserve immutable release identities and restart requirements
    // when executable bytes genuinely change.
    domainEvents.emit("plugin.deactivated", { pluginId: id, actorId });
    return deactivated;
  }

  /**
   * Recovers a plugin stuck in a transitional state ('activating' or 'deactivating')
   * caused by an ungraceful crash or abandoned worker/replica operation.
   * Atomically transitions stuck states using optimistic locking.
   */
  async recoverPluginLifecycle(
    id: string,
    actorId: string | null,
    confirmedQuiescent = false,
  ): Promise<Plugin> {
    // HTTP request alone cannot prove other replicas are stopped. Require the
    // operator to start a dedicated maintenance instance and explicitly attest
    // that all normal API/worker replicas have been shut down and drained.
    if (!this.recoveryMaintenance || !confirmedQuiescent) {
      throw new PluginDomainError(
        "PLUGIN_RECOVERY_NOT_QUIESCENT",
        "Recovery requires isolated maintenance mode and confirmed stopped runtimes",
      );
    }
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "activating" && plugin.status !== "deactivating") {
      throw new PluginDomainError(
        "PLUGIN_NOT_IN_TRANSITION",
        "Plugin is not in a transitional lifecycle state",
      );
    }
    // Prevent accidental interruption of ordinary slow lifecycle operations.
    // Time passage alone does not prove death; maintenance + attestation remain mandatory.
    const ageMs = Date.now() - plugin.updatedAt.getTime();
    if (!Number.isFinite(ageMs) || ageMs < 15 * 60 * 1000) {
      throw new PluginDomainError(
        "PLUGIN_RECOVERY_TOO_RECENT",
        "Wait at least 15 minutes and verify all runtimes have stopped",
      );
    }
    // Maintenance recovery must work even when the operator has removed a
    // revoked lockfile; rely on this runtime's local ownership instead of
    // trying to authenticate a new artifact during offline recovery.
    const hasActiveInstance = [...this.activeInstances.values()].some(
      (instance) => instance.plugin.id === id,
    );
    if (hasActiveInstance) {
      throw new PluginDomainError(
        "PLUGIN_RECOVERY_LOCAL_ACTIVE",
        "This process still holds a plugin lifecycle instance",
      );
    }
    const targetStatus: PluginStatus = plugin.status === "activating" ? "error" : "inactive";
    const recovered = await this.pluginRepo.tryTransitionStatus(
      id,
      [plugin.status],
      targetStatus,
    );
    if (!recovered) {
      throw new PluginDomainError(
        "PLUGIN_TRANSITION_IN_PROGRESS",
        "Plugin status changed concurrently",
      );
    }
    // Offline recovery resets local release key for the recovered plugin
    this.localReleaseKeys.delete(id);
    domainEvents.emit("plugin.recovered", {
      pluginId: id,
      previousStatus: plugin.status,
      status: targetStatus,
      actorId,
    });
    return recovered;
  }

  /**
   * Gracefully shuts down plugins initialized in this replica on server close.
   */
  async shutdown(): Promise<void> {
    await Promise.allSettled(Array.from(this.initializedHere.values()));
    const instances = Array.from(this.activeInstances.values());
    this.activeInstances.clear();
    this.initializedHere.clear();
    this.localReleaseKeys.clear();
    for (const { plugin, module } of instances) {
      try {
        await module.deactivate?.();
      } catch {
        // Raw plugin exceptions may include secrets, stack traces or paths.
        console.warn(
          `[plugins] Plugin shutdown deactivation failed: manifestId=${plugin.manifestId} code=PLUGIN_SHUTDOWN_DEACTIVATION_FAILED`,
        );
      }
    }
  }

  async unregisterPlugin(id: string, actorId: string | null): Promise<void> {
    const plugin = await this.pluginRepo.findById(id);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (await this.pluginRepo.hasAppliedMigrations?.(id)) {
      throw new PluginDomainError(
        "PLUGIN_HAS_SCHEMA_MIGRATIONS",
        "Plugin has irreversible migration history; restore/retire it using an operator-reviewed process",
      );
    }
    if (this.publicationStates && await this.publicationStates.hasAnyState(id)) {
      // Keep publication decisions and plugin metadata for safe reactivation.
      // A future explicit purge must be separate, authorized, backed up and audited.
      throw new PluginDomainError(
        "PLUGIN_HAS_PUBLICATIONS", "Disable and review publication installations before uninstall",
      );
    }
    if (plugin.status === "active" || plugin.status === "activating" ||
        plugin.status === "deactivating") {
      throw new PluginDomainError(
        "PLUGIN_ACTIVE", "Finish or recover the plugin lifecycle before uninstalling it",
      );
    }
    await this.pluginRepo.delete(id);
    domainEvents.emit("plugin.unregistered", { pluginId: id, actorId });
  }

  async listPlugins(): Promise<Plugin[]> {
    return this.pluginRepo.list();
  }

  /** Operator-approved external package discovery, no client-provided manifest trust. */
  async listOperatorManifests(): Promise<Array<{
    id: string;
    name: string;
    version: string;
    description: string | null;
    capabilities: string[];
    /** True only when the detached operator Ed25519 lockfile signature was verified. */
    signatureVerified: boolean | null;
    /** SHA-256-bound immutable approval identity, including legacy lockfile v1. */
    approvalId?: string;
    /** Not a runtime readiness guarantee; checked by the server at registration. */
    readiness: "verification_required";
    upgradeReview?: {
      installedVersion: string;
      installedStatus: PluginStatus;
      addedCapabilities: string[];
      removedCapabilities: string[];
      metadataChanged: boolean;
    };
    release?: OperatorTrustedReleaseSummary;
  }>> {
    try {
      // Keep the catalog optional for older PluginHost implementations.
      // A legacy host cannot prove a signature, so never claim it is signed.
      const catalog: Array<{
        manifest: PluginManifest;
        signatureVerified: boolean | null;
        approvalId?: string;
        release?: OperatorTrustedReleaseSummary;
      }> = this.host.getOperatorManifestCatalog
        ? await this.host.getOperatorManifestCatalog()
        : (await this.host.getOperatorManifests?.() ?? []).map((manifest) => ({
            manifest, signatureVerified: null,
          }));
      const installedByManifestId = new Map(
        (await this.pluginRepo.list()).map((plugin) => [plugin.manifestId, plugin]),
      );
      return catalog.map(({ manifest, signatureVerified, release, approvalId }) => {
        const existing = installedByManifestId.get(manifest.id);
        const nextCapabilities = new Set(manifest.capabilities);
        const previousCapabilities = new Set(existing?.capabilities ?? []);
        const addedCapabilities = manifest.capabilities.filter((cap) => !previousCapabilities.has(cap));
        const removedCapabilities = (existing?.capabilities ?? [])
          .filter((cap) => !nextCapabilities.has(cap));
        return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        capabilities: [...manifest.capabilities],
        signatureVerified,
        readiness: "verification_required" as const,
        ...(approvalId ? { approvalId } : {}),
        ...(release ? { release } : {}),
        ...(existing ? { upgradeReview: {
          installedVersion: existing.version,
          installedStatus: existing.status,
          addedCapabilities,
          removedCapabilities,
          metadataChanged: existing.version !== manifest.version ||
            existing.name !== manifest.name ||
            existing.description !== (manifest.description ?? null) ||
            existing.vibressApiVersion !== manifest.vibressApiVersion ||
            existing.entrypoint !== manifest.entrypoint ||
            !isDeepStrictEqual(existing.capabilities, manifest.capabilities) ||
            !isDeepStrictEqual(existing.hooks, manifest.hooks ?? []) ||
            !isDeepStrictEqual(existing.settingsSchema, manifest.settingsSchema ?? {}),
        } } : {}),
      };
      });
    } catch {
      throw new PluginDomainError("PLUGIN_REGISTRY_UNAVAILABLE", "Trusted plugin registry is unavailable");
    }
  }

  async registerOperatorPlugin(
    manifestId: string, actorId: string | null, expectedReleaseId?: string,
    acknowledgeUpgrade = false,
  ): Promise<Plugin> {
    let approved: PluginManifest | undefined;
    try {
      if (expectedReleaseId !== undefined) {
        // The client may reference an identity, never nominate executable data.
        const entry = (await this.host.getOperatorManifestCatalog?.() ?? [])
          .find((candidate) => candidate.manifest.id === manifestId);
        if (!entry?.approvalId || entry.approvalId !== expectedReleaseId) {
          throw new PluginDomainError(
            "PLUGIN_RELEASE_CHANGED", "Approved plugin release changed; reload and review it",
          );
        }
        approved = entry.manifest;
      } else {
        // Backwards-compatible v1 registration body, still operator-only.
        approved = (await this.host.getOperatorManifests?.() ?? [])
          .find((manifest) => manifest.id === manifestId);
      }
      if (!approved) {
        throw new PluginDomainError("PLUGIN_NOT_TRUSTED", "Plugin is not approved by the operator");
      }
      if (expectedReleaseId !== undefined) {
        const installed = await this.pluginRepo.findByManifestId(manifestId);
        if (installed && !acknowledgeUpgrade) {
          // Persisted v1 plugin rows have no artifact digest. A same-version
          // replacement could therefore change executable bytes invisibly;
          // treat EVERY pinned re-registration as an operator-reviewed update.
          throw new PluginDomainError("PLUGIN_UPGRADE_REVIEW_REQUIRED",
            "Review release and capability changes before updating");
        }
      }
      await this.host.verifyOperatorRegistration?.();
    } catch (error: unknown) {
      if (error instanceof PluginDomainError) throw error;
      throw new PluginDomainError("PLUGIN_REGISTRY_UNAVAILABLE", "Trusted plugin registry is unavailable");
    }
    // Host rechecks the same digest identity before the persistence boundary.
    return this.registerPlugin(approved, actorId, expectedReleaseId);
  }

  /**
   * This returns only operator-approved artifact identifiers, never runtime
   * capabilities or a publication authorization decision.
   */
  async listOperatorAdminFingerprints(): Promise<ReadonlyMap<string, string>> {
    this.assertRuntimeAllowed();
    return this.host.getOperatorAdminFingerprints?.() ?? new Map();
  }

  /**
   * EXT-301B2: internal, publication-scoped approval of a UI artifact.
   * An HTTP caller must independently check the admitted view and Staff
   * permission before calling this method. The Host still rechecks plugin
   * activation, publication enablement and operator artifact approval on both
   * sides of the filesystem read. Never serve these bytes directly as HTML.
   */
  async readExtensionAdminUiAsset(
    manifestId: string, publicationId: string, viewId: string,
  ): Promise<string | null> {
    this.assertRuntimeAllowed();
    if (!publicationId || !this.host.readApprovedAdminUiAsset) return null;
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) ||
        !plugin.capabilities.includes("admin.navigation") ||
        !plugin.capabilities.includes("extension.routes.admin")) return null;
    await this.requirePublicationEnabled(plugin, publicationId);
    const document = await this.host.readApprovedAdminUiAsset(plugin, viewId);
    if (document === null) return null;
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" ||
        latest.version !== plugin.version ||
        latest.vibressApiVersion !== plugin.vibressApiVersion ||
        latest.entrypoint !== plugin.entrypoint ||
        !isDeepStrictEqual(latest.capabilities, plugin.capabilities) ||
        !latest.capabilities.includes("admin.navigation") ||
        !latest.capabilities.includes("extension.routes.admin")) return null;
    await this.requirePublicationEnabled(latest, publicationId);
    return document;
  }

  /** Additive Admin projection; global v1 activation remains unchanged. */
  async listPluginsForPublication(publicationId?: string): Promise<
    Array<Plugin & { publicationScoped: boolean; publicationEnabled: boolean;
      publicationConfiguredEnabled: boolean; hostCompatible: boolean }>
  > {
    const plugins = await this.pluginRepo.list();
    return Promise.all(plugins.map(async (plugin) => {
      const publicationScoped = this.host.requiresPublicationEnablement?.(plugin) === true;
      // Persisted site preference is distinct from effective active execution.
      // Disabling globally must never silently overwrite or conceal the setting.
      const publicationConfiguredEnabled = publicationScoped
        ? Boolean(publicationId && this.publicationStates &&
            await this.publicationStates.isEnabled(plugin.id, publicationId))
        : plugin.status === "active";
      const publicationEnabled = publicationConfiguredEnabled && plugin.status === "active";
      return { ...plugin, publicationScoped, publicationEnabled,
        publicationConfiguredEnabled,
        hostCompatible: plugin.vibressApiVersion === SDK_VERSION };
    }));
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    return this.pluginRepo.findById(id);
  }

  /**
   * Enables a globally installed/activated plugin only in the authoritative
   * staff publication. Existing bundled v1 plugins retain global semantics.
   * The caller must have already passed Staff session + plugins.manage.
   */
  async setPublicationEnabled(
    pluginId: string,
    publicationId: string,
    enabled: boolean,
  ): Promise<boolean> {
    if (!publicationId) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (!this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError("PLUGIN_LEGACY_GLOBAL", "Bundled v1 plugins have global activation");
    }
    if (!this.publicationStates) {
      throw new PluginDomainError("PLUGIN_STATE_UNAVAILABLE", "Publication plugin state is unavailable");
    }
    if (enabled && plugin.vibressApiVersion !== SDK_VERSION) {
      throw new PluginDomainError("PLUGIN_INCOMPATIBLE_API_VERSION",
        "Plugin Host API version is incompatible; operator-approved upgrade required");
    }
    if (enabled && plugin.status !== "active") {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Activate the installed plugin before enabling it");
    }
    await this.publicationStates.setEnabled(pluginId, publicationId, enabled);
    domainEvents.emit("plugin.publication_changed", { pluginId, publicationId, enabled });
    return enabled;
  }

  async isPublicationEnabled(pluginId: string, publicationId: string): Promise<boolean> {
    if (!publicationId) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication is required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "active") return false;
    if (!this.host.requiresPublicationEnablement?.(plugin)) return true;
    if (!this.publicationStates) return false;
    return this.publicationStates.isEnabled(plugin.id, publicationId);
  }

  /**
   * Resolve an admitted external module only after host authentication and
   * host-authoritative publication resolution. Module code stays trusted;
   * this is NOT process isolation. Legacy bundled modules cannot contribute
   * publication-scoped routes without explicit external admission.
   */
  async resolveExtensionApiModule(
    manifestId: string,
    publicationId: string,
    capability: "extension.routes.admin" | "extension.routes.member" | "extension.routes.public",
  ): Promise<PluginModule | null> {
    this.assertRuntimeAllowed();
    if (!publicationId) return null;
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) ||
        !plugin.capabilities.includes(capability)) return null;
    await this.requirePublicationEnabled(plugin, publicationId);
    const module = await this.host.loadModule(plugin);
    if (!module) return null;
    // Reading trusted route descriptors must NOT trigger activate() before
    // host-enforced Staff permission and request validation.
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" ||
        latest.version !== plugin.version ||
        latest.vibressApiVersion !== plugin.vibressApiVersion ||
        latest.entrypoint !== plugin.entrypoint ||
        !isDeepStrictEqual(latest.capabilities, plugin.capabilities) ||
        !latest.capabilities.includes(capability)) return null;
    await this.requirePublicationEnabled(latest, publicationId);
    return module;
  }

  /** Call only after the HTTP host has authorized the route and validated its input. */
  async prepareExtensionApiExecution(
    manifestId: string,
    publicationId: string,
    capability: "extension.routes.admin" | "extension.routes.member" | "extension.routes.public",
    module: PluginModule,
  ): Promise<boolean> {
    this.assertRuntimeAllowed();
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) ||
        !plugin.capabilities.includes(capability)) return false;
    await this.requirePublicationEnabled(plugin, publicationId);
    await this.ensureInitializedHere(plugin, module);
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" ||
        latest.version !== plugin.version ||
        latest.vibressApiVersion !== plugin.vibressApiVersion ||
        latest.entrypoint !== plugin.entrypoint ||
        !isDeepStrictEqual(latest.capabilities, plugin.capabilities) ||
        !latest.capabilities.includes(capability)) return false;
    await this.requirePublicationEnabled(latest, publicationId);
    return true;
  }

  /**
   * Member-facing bridge admission only. The Host must first authenticate the
   * Member AND verify that the site publication equals its session's tenant.
   * Repository independently rechecks capability, state and member on EVERY
   * lookup, including after deactivation or member disabling.
   */
  async resolveExtensionMemberBinding(
    manifestId: string,
    publicationId: string,
  ): Promise<{ pluginId: string; publicationId: string } | null> {
    this.assertRuntimeAllowed();
    if (!publicationId) return null;
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    const allowed = (value: Plugin) =>
      value.capabilities.some((capability) =>
        capability === "extension.members.self.read" ||
        capability === "extension.entitlements.plan.read");
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) || !allowed(plugin)) {
      return null;
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" || !allowed(latest)) return null;
    await this.requirePublicationEnabled(latest, publicationId);
    return { pluginId: latest.id, publicationId };
  }

  /** Optional Member-owned storage: distinct from privileged Staff storage. */
  async resolveExtensionMemberStorageBinding(
    manifestId: string, publicationId: string,
  ): Promise<{ pluginId: string; publicationId: string;
    models: readonly ApprovedPluginPhysicalModel[] } | null> {
    this.assertRuntimeAllowed();
    if (!publicationId) return null;
    const permitted = (value: Plugin) => value.capabilities.some((capability) =>
      capability === "extension.member_storage.read" ||
      capability === "extension.member_storage.write");
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) || !permitted(plugin)) return null;
    await this.requirePublicationEnabled(plugin, publicationId);
    const models = await this.host.getApprovedStorageModels?.(plugin);
    if (!models?.length || models.length > 16) return null;
    const keys = new Set<string>();
    for (const model of models) {
      validateStorageModel(model);
      if (keys.has(model.key)) return null;
      keys.add(model.key);
    }
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" ||
        latest.version !== plugin.version ||
        latest.vibressApiVersion !== plugin.vibressApiVersion ||
        latest.entrypoint !== plugin.entrypoint ||
        !isDeepStrictEqual(latest.capabilities, plugin.capabilities) ||
        !permitted(latest)) return null;
    await this.requirePublicationEnabled(latest, publicationId);
    return { pluginId: plugin.id, publicationId, models };
  }

  /**
   * Resolve installed owner and trusted schema for an already authenticated
   * Host endpoint. Plugin-supplied model descriptors are never admitted here.
   * The DB adapter repeats all capability/enablement/ownership checks per call.
   */
  async resolveExtensionStorageBinding(
    manifestId: string,
    publicationId: string,
    requiredCapability: "extension.storage.read" | "extension.storage.write" = "extension.storage.read",
    audience: "staff" | "public" | "member" = "staff",
  ): Promise<{ pluginId: string; publicationId: string;
    models: readonly ApprovedPluginPhysicalModel[] } | null> {
    this.assertRuntimeAllowed();
    if (!publicationId) return null;
    const plugin = await this.pluginRepo.findByManifestId(manifestId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) ||
        !plugin.capabilities.includes(requiredCapability)) {
      return null;
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    const models = await this.host.getApprovedStorageModels?.(plugin);
    if (!models?.length || models.length > 16) return null;
    const unique = new Set<string>();
    for (const model of models) {
      validateStorageModel(model);
      if (unique.has(model.key)) return null;
      unique.add(model.key);
    }
    const latest = await this.pluginRepo.findById(plugin.id);
    if (!latest || latest.status !== "active" ||
        !latest.capabilities.includes(requiredCapability)) {
      return null;
    }
    await this.requirePublicationEnabled(latest, publicationId);
    if (audience !== "staff" && this.host.getApprovedAudienceReadModels) {
      const allowed = await this.host.getApprovedAudienceReadModels(latest, audience);
      if (allowed !== null) {
        const granted = new Set(allowed);
        const audienceModels = models.filter((model) => granted.has(model.key));
        // Never create an unrestricted session from an explicit empty list.
        if (!audienceModels.length) return null;
        return { pluginId: latest.id, publicationId, models: audienceModels };
      }
    }
    return { pluginId: latest.id, publicationId, models };
  }

  private async requirePublicationEnabled(plugin: Plugin, publicationId?: string): Promise<void> {
    if (!this.host.requiresPublicationEnablement?.(plugin)) return;
    if (!publicationId || !this.publicationStates ||
        !(await this.publicationStates.isEnabled(plugin.id, publicationId))) {
      throw new PluginDomainError(
        "PLUGIN_PUBLICATION_INACTIVE", "Plugin is not enabled for this publication",
      );
    }
  }

  /** Scoped values never read from legacy platform-global plugin_settings. */
  async setPublicationSettings(
    pluginId: string,
    publicationId: string,
    settings: Record<string, string | null>,
    audit?: PluginSettingAuditContext,
  ): Promise<void> {
    if (!publicationId || !this.publicationSettings || !this.publicationStates) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication scope is unavailable");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (!this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError("PLUGIN_LEGACY_GLOBAL", "Bundled plugins use legacy global settings");
    }
    if (!(await this.publicationStates.isEnabled(pluginId, publicationId))) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_INACTIVE", "Enable this plugin for the publication first");
    }
    const defs = this.getSettingDefinitions(plugin.settingsSchema);
    const entries: Array<{
      key: string;
      value: string | null;
      encryptedValue: string | null;
      isSecret: boolean;
    }> = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(key) || !Object.hasOwn(defs, key)) {
        throw new PluginDomainError("PLUGIN_SETTING_UNKNOWN", "Unknown plugin setting key");
      }
      const definition = defs[key];
      if (!definition || typeof definition !== "object" || Array.isArray(definition) ||
        !("type" in definition) || definition.type !== "string") {
        throw new PluginDomainError("PLUGIN_SETTING_INVALID", "Only declared string settings are supported");
      }
      if (value !== null && (typeof value !== "string" || value.length > 4096)) {
        throw new PluginDomainError("PLUGIN_SETTING_INVALID", "Invalid plugin setting value");
      }
      const isSecret = "secret" in definition && definition.secret === true;
      if (isSecret && (value === null || value === "")) continue; // replace only
      entries.push({
        key,
        isSecret,
        value: isSecret ? null : value,
        encryptedValue: isSecret && value !== null ? encryptSecret(value) : null,
      });
    }
    if (entries.length > 0) {
      await this.publicationSettings.setMany(pluginId, publicationId, entries, audit);
    }
  }

  /** A secret's empty/null update is replace-only; revocation is explicit.
   * The production adapter deletes and audits in the same DB transaction. */
  async revokePublicationSecret(
    pluginId: string,
    publicationId: string,
    key: string,
    audit: PluginSettingAuditContext,
  ): Promise<boolean> {
    if (!publicationId || !this.publicationSettings || !this.publicationStates ||
        !this.publicationSettings.deleteSecret) {
      throw new PluginDomainError("PLUGIN_STATE_UNAVAILABLE", "Scoped secrets unavailable");
    }
    if (!audit.actorUserId || !audit.requestId) {
      throw new PluginDomainError("PLUGIN_SETTING_INVALID", "Audit identity required");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError("PLUGIN_INACTIVE", "Plugin unavailable");
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    const definitions = this.getSettingDefinitions(plugin.settingsSchema);
    const definition = Object.hasOwn(definitions, key) ? definitions[key] : undefined;
    if (!definition || typeof definition !== "object" || Array.isArray(definition) ||
        !("type" in definition) || definition.type !== "string" ||
        !("secret" in definition) || definition.secret !== true) {
      throw new PluginDomainError("PLUGIN_SETTING_INVALID", "Unknown secret setting");
    }
    return this.publicationSettings.deleteSecret(pluginId, publicationId, key, audit);
  }

  async listPublicationSettings(
    pluginId: string,
    publicationId: string,
  ): Promise<Array<{ key: string; value: string | null; isSecret: boolean; masked: boolean }>> {
    if (!publicationId || !this.publicationSettings) {
      throw new PluginDomainError("PLUGIN_PUBLICATION_REQUIRED", "Publication scope is unavailable");
    }
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (!this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError("PLUGIN_LEGACY_GLOBAL", "Bundled plugins use legacy global settings");
    }
    const definitions = this.getSettingDefinitions(plugin.settingsSchema);
    const records = await this.publicationSettings.listForPlugin(pluginId, publicationId);
    return records.flatMap((record) => {
      const definition = definitions[record.key];
      if (!definition || typeof definition !== "object" || Array.isArray(definition) ||
          !("type" in definition) || definition.type !== "string") return [];
      // A secret according to EITHER the persisted row or current manifest
      // must never be exposed as plaintext, even after an inconsistent upgrade.
      const declaredSecret = "secret" in definition && definition.secret === true;
      const isSecret = record.isSecret || declaredSecret;
      return [{
        key: record.key,
        value: isSecret ? "••••••••" : record.value,
        isSecret,
        masked: isSecret,
      }];
    });
  }

  private async loadPublicationSettings(
    pluginId: string,
    publicationId: string,
  ): Promise<Record<string, unknown>> {
    if (!this.publicationSettings) return {};
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) return {};
    const definitions = this.getSettingDefinitions(plugin.settingsSchema);
    const data = await this.publicationSettings.listForPlugin(pluginId, publicationId);
    const settings: Record<string, unknown> = {};
    for (const item of data) {
      const definition = definitions[item.key];
      if (!definition || typeof definition !== "object" ||
          !("type" in definition) || definition.type !== "string" ||
          ("secret" in definition && definition.secret === true)) continue;
      if (!item.isSecret && item.value !== null) settings[item.key] = item.value;
    }
    return settings;
  }

  private async getPublicationSecret(
    pluginId: string,
    publicationId: string,
    key: string,
    admittedReleaseKey?: string,
  ): Promise<string | null> {
    if (!this.publicationSettings || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(key)) return null;
    // An extension can retain a getSecret closure beyond the initial event.
    // Never let that closure outlive publication enablement or its capability.
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin || plugin.status !== "active" ||
        !this.host.requiresPublicationEnablement?.(plugin) ||
        !plugin.capabilities.includes("settings.read-own")) {
      throw new PluginDomainError("PLUGIN_SECRET_ACCESS_REVOKED", "Plugin secret access revoked");
    }
    await this.requirePublicationEnabled(plugin, publicationId);
    if (admittedReleaseKey) {
      const currentReleaseKey = await this.activationKey(plugin);
      if (currentReleaseKey !== admittedReleaseKey) {
        throw new PluginDomainError("PLUGIN_SECRET_ACCESS_REVOKED", "Plugin secret access revoked");
      }
    }
    const encrypted = await this.publicationSettings.getSecret(pluginId, publicationId, key);
    if (!encrypted) return null;
    let plaintext: string;
    try {
      plaintext = decryptSecret(encrypted);
    } catch {
      // Corruption is an operational problem, not a missing setting: fail closed.
      throw new PluginDomainError("PLUGIN_SECRET_CORRUPT", "Plugin secret cannot be decrypted");
    }
    const latest = await this.pluginRepo.findById(pluginId);
    if (!latest || !this.sameExecutionRelease(plugin, latest) ||
        !latest.capabilities.includes("settings.read-own")) {
      throw new PluginDomainError("PLUGIN_SECRET_ACCESS_REVOKED", "Plugin secret access revoked");
    }
    await this.requirePublicationEnabled(latest, publicationId);
    if (admittedReleaseKey &&
        await this.activationKey(latest) !== admittedReleaseKey) {
      throw new PluginDomainError("PLUGIN_SECRET_ACCESS_REVOKED", "Plugin secret access revoked");
    }
    return plaintext;
  }

  private getSettingDefinitions(schema: Record<string, unknown>): Record<string, unknown> {
    const raw: unknown = Object.hasOwn(schema, "properties") ? schema.properties : schema;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PluginDomainError(
        "PLUGIN_SETTINGS_SCHEMA_INVALID", "Plugin settings schema is invalid",
      );
    }
    return raw as Record<string, unknown>;
  }

  // ---------------- Settings ----------------

  /**
   * Declarative settings: non-secret values are stored plainly, secrets are
   * encrypted at rest and replace-only (existing secret values are kept when
   * the incoming value is null/empty).
   */
  async setSettings(
    pluginId: string,
    settings: Record<string, unknown>,
    schema?: Record<string, unknown>,
  ): Promise<void> {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin)
      throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError(
        "PLUGIN_SETTINGS_NOT_SCOPED",
        "External plugin settings require publication-scoped storage",
      );
    }

    const schemaMap = (schema || plugin.settingsSchema || {}) as Record<
      string,
      { type?: string; secret?: boolean }
    >;
    for (const [key, value] of Object.entries(settings)) {
      const isSecret = schemaMap[key]?.secret === true;
      if (isSecret) {
        const current = await this.settingRepo.getSecret(pluginId, key);
        if (value === null || value === "" || value === undefined) {
          // Replace-only: keep existing encrypted secret
          if (current) continue;
          continue;
        }
        await this.settingRepo.set(
          pluginId,
          key,
          null,
          encryptSecret(String(value)),
          true,
        );
      } else {
        await this.settingRepo.set(
          pluginId,
          key,
          value === null || value === undefined ? null : String(value),
          null,
          false,
        );
      }
    }
  }

  async listSettings(
    pluginId: string,
  ): Promise<
    Array<{
      key: string;
      value: string | null;
      isSecret: boolean;
      masked: boolean;
    }>
  > {
    const plugin = await this.pluginRepo.findById(pluginId);
    if (!plugin) throw new PluginDomainError("PLUGIN_NOT_FOUND", "Plugin not found");
    if (this.host.requiresPublicationEnablement?.(plugin)) {
      throw new PluginDomainError(
        "PLUGIN_SETTINGS_NOT_SCOPED",
        "External plugin settings require publication-scoped storage",
      );
    }
    const settings = await this.settingRepo.listForPlugin(pluginId);
    return settings.map((s) => ({
      key: s.key,
      value: s.isSecret ? "••••••••" : s.value,
      isSecret: s.isSecret,
      masked: s.isSecret,
    }));
  }

  private async loadPlainSettings(
    pluginId: string,
  ): Promise<Record<string, unknown>> {
    const settings = await this.settingRepo.listForPlugin(pluginId);
    const out: Record<string, unknown> = {};
    for (const s of settings) {
      if (s.isSecret) continue; // secrets only via context.getSecret
      if (s.value !== null) out[s.key] = s.value;
    }
    return out;
  }

  private async getDecryptedSecret(
    pluginId: string,
    key: string,
  ): Promise<string | null> {
    const encrypted = await this.settingRepo.getSecret(pluginId, key);
    if (!encrypted) return null;
    try {
      return decryptSecret(encrypted);
    } catch {
      return null;
    }
  }
}
