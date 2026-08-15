/**
 * First-run installation state.
 *
 * Only two persistent states exist: not installed (installed=false) and
 * installed (installed=true). An in-flight installation is represented by
 * the PostgreSQL row lock on the singleton, not by a stored state value —
 * a crash before commit rolls back and leaves installed=false; a successful
 * commit sets installed=true. There is deliberately no intermediate state.
 */

export type InstallationSource = "fresh" | "legacy_backfill";

export interface InstallationRecord {
  id: string;
  installed: boolean;
  installedAt: Date | null;
  installedVersion: string | null;
  installationSource: InstallationSource;
  createdAt: Date;
  updatedAt: Date;
}

export const INSTALLATION_SINGLETON_ID = "singleton";

export interface InstallationRepository {
  /**
   * Reads the singleton without locking (safe for status reads).
   * The row is guaranteed to exist once migrations have run.
   */
  getSingleton(): Promise<InstallationRecord | null>;

  /**
   * Reads the singleton with `FOR UPDATE`, serializing concurrent setup
   * transactions. Always used inside a transaction.
   */
  getSingletonForUpdate(): Promise<InstallationRecord | null>;

  /** Marks the installation complete (idempotent, inside a transaction). */
  markInstalled(input: {
    version: string | null;
    source: InstallationSource;
    installedAt?: Date | null;
    now?: Date;
  }): Promise<void>;

  /**
   * Counts trustworthy legacy-installation signals for the boot backfill:
   * active owner accounts, site settings, and non-deleted content.
   */
  countLegacySignals(): Promise<{
    activeOwners: number;
    siteSettings: number;
    posts: number;
    pages: number;
  }>;
}

export class SetupDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SetupDomainError";
    this.code = code;
  }
}
