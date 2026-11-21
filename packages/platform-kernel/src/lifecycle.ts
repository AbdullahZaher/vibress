import {
  asApplicationId,
  asInstallationId,
  type ApplicationId,
  type InstallationId,
} from "./identity";

/**
 * M01-E02/E06 — public application lifecycle contract.
 *
 * Pure, deterministic and independent of CMS, database and HTTP adapters.
 * Every transition is compare-and-swap guarded so a stale operator cannot
 * overwrite a newer lifecycle record.
 */
export const LIFECYCLE_STATES = Object.freeze([
  "REGISTERED",
  "INSTALLED",
  "ACTIVE",
  "SUSPENDED",
  "REMOVED",
] as const);

export type ApplicationLifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_EVENTS = Object.freeze([
  "install",
  "activate",
  "suspend",
  "resume",
  "upgrade",
  "remove",
] as const);

export type ApplicationLifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<ApplicationLifecycleState, readonly ApplicationLifecycleEvent[]>
> = Object.freeze({
  REGISTERED: ["install", "remove"],
  INSTALLED: ["activate", "remove"],
  ACTIVE: ["suspend", "upgrade", "remove"],
  SUSPENDED: ["resume", "upgrade", "remove"],
  REMOVED: [],
});

export interface ApplicationLifecycle {
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly manifestDigest: string;
  readonly schemaRevision: string;
  readonly state: ApplicationLifecycleState;
  readonly revision: number;
  readonly history: readonly ApplicationLifecycleEvent[];
}

export interface LifecycleTransitionInput {
  readonly applicationId: ApplicationId | string;
  readonly installationId: InstallationId | string;
  readonly expectedRevision: number;
  readonly manifestDigest?: string;
  readonly schemaRevision?: string;
}

export type LifecycleErrorCode =
  | "INVALID_TRANSITION"
  | "REVISION_CONFLICT"
  | "IDENTITY_MISMATCH"
  | "INVALID_EVIDENCE";

export class ApplicationLifecycleError extends Error {
  readonly code: LifecycleErrorCode;

  constructor(code: LifecycleErrorCode, reason: string) {
    super(reason);
    this.name = "ApplicationLifecycleError";
    this.code = code;
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function createApplicationLifecycle(input: {
  readonly applicationId: ApplicationId | string;
  readonly installationId: InstallationId | string;
  readonly manifestDigest: string;
  readonly schemaRevision: string;
}): ApplicationLifecycle {
  const applicationId = asApplicationId(input.applicationId);
  const installationId = asInstallationId(input.installationId);
  if (!DIGEST_PATTERN.test(input.manifestDigest ?? "")) {
    throw new ApplicationLifecycleError(
      "INVALID_EVIDENCE",
      "manifestDigest must be a sha256 hex digest",
    );
  }
  if (
    typeof input.schemaRevision !== "string" ||
    input.schemaRevision.trim() === ""
  ) {
    throw new ApplicationLifecycleError(
      "INVALID_EVIDENCE",
      "schemaRevision must be a non-empty string",
    );
  }
  return Object.freeze({
    applicationId,
    installationId,
    manifestDigest: input.manifestDigest,
    schemaRevision: input.schemaRevision,
    state: "REGISTERED" as const,
    revision: 0,
    history: Object.freeze([]),
  });
}

export function transitionApplicationLifecycle(
  lifecycle: ApplicationLifecycle,
  event: ApplicationLifecycleEvent,
  input: LifecycleTransitionInput,
): ApplicationLifecycle {
  if (
    !LIFECYCLE_EVENTS.includes(event) ||
    !ALLOWED_TRANSITIONS[lifecycle.state].includes(event)
  ) {
    throw new ApplicationLifecycleError(
      "INVALID_TRANSITION",
      `${event} is not allowed from ${lifecycle.state}`,
    );
  }
  if (input.expectedRevision !== lifecycle.revision) {
    throw new ApplicationLifecycleError(
      "REVISION_CONFLICT",
      `expected revision ${input.expectedRevision}, current ${lifecycle.revision}`,
    );
  }
  if (
    input.applicationId !== lifecycle.applicationId ||
    input.installationId !== lifecycle.installationId
  ) {
    throw new ApplicationLifecycleError(
      "IDENTITY_MISMATCH",
      "transition identity does not match the registered application/installation",
    );
  }
  if (event === "upgrade") {
    if (!DIGEST_PATTERN.test(input.manifestDigest ?? "")) {
      throw new ApplicationLifecycleError(
        "INVALID_EVIDENCE",
        "upgrade requires a sha256 manifestDigest",
      );
    }
    if (
      typeof input.schemaRevision !== "string" ||
      input.schemaRevision.trim() === ""
    ) {
      throw new ApplicationLifecycleError(
        "INVALID_EVIDENCE",
        "upgrade requires a non-empty schemaRevision",
      );
    }
  }

  const nextState: ApplicationLifecycleState =
    event === "install"
      ? "INSTALLED"
      : event === "activate" || event === "upgrade" || event === "resume"
        ? "ACTIVE"
        : event === "suspend"
          ? "SUSPENDED"
          : "REMOVED";

  return Object.freeze({
    applicationId: lifecycle.applicationId,
    installationId: lifecycle.installationId,
    manifestDigest:
      event === "upgrade" ? input.manifestDigest! : lifecycle.manifestDigest,
    schemaRevision:
      event === "upgrade" ? input.schemaRevision! : lifecycle.schemaRevision,
    state: nextState,
    revision: lifecycle.revision + 1,
    history: Object.freeze([...lifecycle.history, event]),
  });
}

export function isTerminalLifecycle(
  lifecycle: ApplicationLifecycle,
): boolean {
  return lifecycle.state === "REMOVED";
}
