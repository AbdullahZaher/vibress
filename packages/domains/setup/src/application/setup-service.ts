import crypto from "node:crypto";
import { runInTransaction, getDb } from "@vibress/database";
import { sql } from "drizzle-orm";
import { UsersService, DrizzleUserRepository, User } from "@vibress/users";
import { RolesService, DrizzleRoleRepository } from "@vibress/roles";
import { AuditService, DrizzleAuditRepository } from "@vibress/audit";
import {
  DrizzleSettingRepository,
  SettingRepository,
  SETTING_NAMESPACES,
  SettingValueType,
  SettingClassification,
} from "@vibress/settings";
import {
  hashPassword,
  validatePasswordPolicy,
  hashToken,
} from "@vibress/security";
import {
  InstallationRepository,
  SetupDomainError,
} from "../domain/installation";

export interface SetupSiteInput {
  name: string;
  description: string;
  locale: string;
  tagline?: string | undefined;
}

export interface SetupOwnerInput {
  name: string;
  email: string;
  password: string;
}

export interface SetupCompleteInput {
  site: SetupSiteInput;
  owner: SetupOwnerInput;
}

export interface SetupCompleteResult {
  user: User;
  roles: string[];
}

export interface SetupContext {
  applicationVersion: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Locale is a wizard-managed site field; keep the same light validation the
 * rest of the platform applies to SITE_LOCALE (a BCP-47-ish tag), defaulting
 * to 'en'.
 */
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/;

export function validateSetupLocale(locale: string): boolean {
  return LOCALE_RE.test(locale.trim());
}

export function isSetupTokenInsecure(
  token: string | null | undefined,
): boolean {
  if (!token || typeof token !== "string") return true;
  const trimmed = token.trim();
  if (trimmed.length < 16) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes("change-me") ||
    lower.includes("changeme") ||
    lower === "dev" ||
    lower === "development"
  );
}

/**
 * Timing-safe comparison of the presented setup token against the configured
 * secret. Both sides are SHA-256-hashed to equal length before comparison,
 * reusing the platform token primitives.
 */
export function setupTokenMatches(
  presented: string,
  configured: string,
): boolean {
  if (typeof presented !== "string" || typeof configured !== "string")
    return false;
  const a = Buffer.from(hashToken(presented), "hex");
  const b = Buffer.from(hashToken(configured), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export class SetupService {
  private userRepo = new DrizzleUserRepository();
  private usersService: UsersService;
  private rolesService: RolesService;
  private auditService: AuditService;
  private settingsRepo: SettingRepository;

  constructor(
    private installationRepo: InstallationRepository,
    settingsRepo?: SettingRepository,
    usersService?: UsersService,
    rolesService?: RolesService,
    auditService?: AuditService,
  ) {
    this.settingsRepo = settingsRepo ?? new DrizzleSettingRepository();
    this.usersService = usersService ?? new UsersService(this.userRepo);
    this.rolesService =
      rolesService ?? new RolesService(new DrizzleRoleRepository());
    this.auditService =
      auditService ?? new AuditService(new DrizzleAuditRepository());
  }

  /** Minimal, non-locking read for the public status endpoint. */
  async getStatus(): Promise<{ installed: boolean }> {
    const record = await this.installationRepo.getSingleton();
    if (!record) {
      // Defensive: the singleton is created by the migration. Treat a missing
      // row as not installed rather than crashing the status endpoint.
      return { installed: false };
    }
    return { installed: record.installed };
  }

  /**
   * Server-side readiness used by the setup preflight. Returns booleans only
   * — never connection details, credentials, or stack traces.
   */
  async getReadiness(): Promise<{
    database: boolean;
    redis: boolean;
    configuration: boolean;
  }> {
    const database = await this.checkDatabase();
    const redis = await this.checkRedis();
    const configuration = true; // config was already parsed at boot (fail-closed in production)
    return { database, redis, configuration };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await getDb().execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const { getRedisClient } = await import("@vibress/cache");
      const pong = await getRedisClient().ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  /**
   * Boot-time backfill: a legacy database (existing Vibress installation) must
   * never be exposed to the wizard. Classifies as INSTALLED when at least one
   * trustworthy signal exists (active owner, site settings, or content).
   * Prefers a false-positive "installed" over exposing /setup on a real site.
   */
  async classifyLegacyInstallation(): Promise<void> {
    await runInTransaction(async () => {
      const record = await this.installationRepo.getSingletonForUpdate();
      if (!record || record.installed) return;

      const signals = await this.installationRepo.countLegacySignals();
      const hasSignal =
        signals.activeOwners > 0 ||
        signals.siteSettings > 0 ||
        signals.posts > 0 ||
        signals.pages > 0;
      if (!hasSignal) return;

      await this.installationRepo.markInstalled({
        version: null,
        source: "legacy_backfill",
      });
      await this.auditService.record({
        actorUserId: null,
        action: "setup.backfilled",
        targetType: "installation",
        targetId: "singleton",
        metadata: {
          installationSource: "legacy_backfill",
          signals: {
            activeOwners: signals.activeOwners,
            siteSettings: signals.siteSettings,
            posts: signals.posts,
            pages: signals.pages,
          },
        },
      });
    });
  }

  /**
   * Atomic first-run installation. Runs inside one transaction: the
   * singleton row is locked, the installed state re-checked, the owner
   * created with the existing 'owner' role, site settings written, an audit
   * event recorded, and the installation marked complete. Any failure rolls
   * back everything — never "owner created but not installed", never
   * "installed but no owner".
   */
  async completeSetup(
    input: SetupCompleteInput,
    context: SetupContext,
  ): Promise<SetupCompleteResult> {
    return runInTransaction(async () => {
      const record = await this.installationRepo.getSingletonForUpdate();
      if (!record) {
        throw new SetupDomainError(
          "INSTALLATION_NOT_FOUND",
          "Installation state is missing; run database migrations first",
        );
      }
      if (record.installed) {
        throw new SetupDomainError(
          "SETUP_ALREADY_COMPLETED",
          "Setup has already been completed",
        );
      }

      const email = input.owner.email.trim().toLowerCase();
      const siteName = input.site.name.trim();
      if (!siteName) {
        throw new SetupDomainError(
          "INVALID_SITE_SETTINGS",
          "Site name is required",
        );
      }
      if (!validateSetupLocale(input.site.locale)) {
        throw new SetupDomainError("INVALID_SITE_SETTINGS", "Invalid locale");
      }

      const passValidation = validatePasswordPolicy(input.owner.password);
      if (!passValidation.valid) {
        throw new SetupDomainError(
          "INVALID_PASSWORD",
          passValidation.reason || "Invalid password",
        );
      }

      const passwordHash = await hashPassword(input.owner.password);

      const user = await this.usersService.createUser({
        email,
        name: input.owner.name.trim(),
        passwordHash,
        status: "active",
      });

      const ownerRole = await this.rolesService.findByKey("owner");
      if (!ownerRole) {
        throw new SetupDomainError(
          "OWNER_ROLE_MISSING",
          "Owner role not found in system roles",
        );
      }
      await this.rolesService.assignRoleToUser(user.id, ownerRole.id);

      await this.writeSiteSettings(user.id, input.site);

      await this.auditService.record({
        actorUserId: user.id,
        action: "setup.completed",
        targetType: "installation",
        targetId: "singleton",
        ipAddress: context.ipAddress ?? undefined,
        userAgent: context.userAgent ?? undefined,
        requestId: context.requestId,
        metadata: {
          installationSource: "fresh",
          applicationVersion: context.applicationVersion,
          ownerUserId: user.id,
        },
      });

      await this.installationRepo.markInstalled({
        version: context.applicationVersion || null,
        source: "fresh",
      });

      return { user, roles: ["owner"] };
    });
  }

  private async writeSiteSettings(
    actorId: string,
    site: SetupSiteInput,
  ): Promise<void> {
    const siteNamespace = SETTING_NAMESPACES.find(
      (ns) => ns.namespace === "site",
    );
    if (!siteNamespace) {
      throw new SetupDomainError(
        "INVALID_SITE_SETTINGS",
        "Site settings namespace is not defined",
      );
    }
    const defOf = (key: string) =>
      siteNamespace.settings.find((s) => s.key === key);

    const entries: Array<{
      key: string;
      value: unknown;
      valueType: SettingValueType;
      classification: SettingClassification;
    }> = [
      {
        key: "title",
        value: site.name,
        valueType: "string",
        classification: "public",
      },
      {
        key: "description",
        value: site.description ?? "",
        valueType: "string",
        classification: "public",
      },
      {
        key: "locale",
        value: site.locale || "en",
        valueType: "string",
        classification: "public",
      },
    ];
    if (site.tagline) {
      entries.push({
        key: "tagline",
        value: site.tagline,
        valueType: "string",
        classification: "public",
      });
    }

    for (const entry of entries) {
      const def = defOf(entry.key);
      if (!def) continue; // unknown key — namespace doesn't define it; skip
      if (def.validate) {
        const error = def.validate(entry.value);
        if (error)
          throw new SetupDomainError(
            "INVALID_SITE_SETTINGS",
            `${entry.key}: ${error}`,
          );
      }
      await this.settingsRepo.set({
        namespace: "site",
        key: entry.key,
        value: entry.value,
        valueType: entry.valueType,
        classification: entry.classification,
        updatedBy: actorId,
      });
    }
  }
}
