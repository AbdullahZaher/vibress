import { createHash } from "node:crypto";
import { HTTP_METHODS, ROUTE_AUTH } from "./application";
import type {
  ApplicationDefinition,
  HttpMethod,
  RouteAuth,
  WebSurfaceDefinition,
} from "./contracts";

/**
 * A serializable view of an application definition.
 *
 * Handler functions and input parsers are code, not data, so a persisted
 * registry stores this manifest and a digest of it. Boot then proves that the
 * deployed code still matches the registered manifest instead of pretending
 * that executable handlers could be persisted.
 */
export const APPLICATION_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ManifestAction {
  readonly name: string;
  readonly permission: string;
}

export interface ManifestRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly action: string;
  readonly auth: RouteAuth;
}

export interface ManifestModule {
  readonly id: string;
  readonly version: string;
  readonly kernelRange: string;
  readonly actions: readonly ManifestAction[];
  readonly http: readonly ManifestRoute[];
}

export interface ApplicationManifest {
  readonly schemaVersion: typeof APPLICATION_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly actions: readonly ManifestAction[];
  readonly http: readonly ManifestRoute[];
  readonly web: WebSurfaceDefinition | null;
  readonly modules: readonly ManifestModule[];
}

export class InvalidApplicationManifestError extends Error {
  constructor(reason: string) {
    super(`Invalid application manifest: ${reason}`);
    this.name = "InvalidApplicationManifestError";
  }
}

function freezeActions(
  actions: Readonly<Record<string, { readonly permission: string }>>,
): readonly ManifestAction[] {
  return Object.freeze(
    Object.keys(actions)
      .sort()
      .map((name) =>
        Object.freeze({ name, permission: actions[name]!.permission }),
      ),
  );
}

function freezeRoutes(
  routes: readonly ManifestRoute[],
): readonly ManifestRoute[] {
  return Object.freeze(routes.map((route) => Object.freeze({ ...route })));
}

function freezeWeb(
  web: WebSurfaceDefinition | undefined,
): WebSurfaceDefinition | null {
  if (!web) return null;
  return Object.freeze({
    clientPackage: web.clientPackage,
    publicRoutes: Object.freeze([...web.publicRoutes]),
    authenticatedRoutes: Object.freeze([...web.authenticatedRoutes]),
  });
}

export function toApplicationManifest(
  application: ApplicationDefinition,
): ApplicationManifest {
  const manifest: ApplicationManifest = {
    schemaVersion: APPLICATION_MANIFEST_SCHEMA_VERSION,
    id: application.id,
    name: application.name,
    version: application.version,
    // Action order is not semantic, so sorting keeps the digest stable.
    actions: freezeActions(application.actions),
    // Route order is semantic: the first matching route wins.
    http: freezeRoutes(application.http),
    web: freezeWeb(application.web),
    modules: Object.freeze(
      (application.modules ?? []).map((module) =>
        Object.freeze({
          id: module.id,
          version: module.version,
          kernelRange: module.kernelRange,
          actions: freezeActions(module.actions),
          http: freezeRoutes(module.http),
        }),
      ),
    ),
  };
  return Object.freeze(manifest);
}

/**
 * The manifest is constructed field-by-field in a fixed order, so plain JSON
 * serialization is canonical. Callers must not mutate a manifest after digest.
 */
export function serializeApplicationManifest(
  manifest: ApplicationManifest,
): string {
  return JSON.stringify(manifest);
}

export function applicationManifestDigest(
  manifest: ApplicationManifest,
): string {
  return createHash("sha256")
    .update(serializeApplicationManifest(manifest), "utf8")
    .digest("hex");
}

export function applicationDefinitionDigest(
  application: ApplicationDefinition,
): string {
  return applicationManifestDigest(toApplicationManifest(application));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidApplicationManifestError(
      `${key} must be a non-empty string`,
    );
  }
  return value;
}

function parseActions(value: unknown, subject: string): ManifestAction[] {
  if (!Array.isArray(value)) {
    throw new InvalidApplicationManifestError(
      `${subject}.actions must be an array`,
    );
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new InvalidApplicationManifestError(
        `${subject}.actions must contain objects`,
      );
    }
    return {
      name: assertString(entry, "name"),
      permission: assertString(entry, "permission"),
    };
  });
}

function parseRoutes(value: unknown, subject: string): ManifestRoute[] {
  if (!Array.isArray(value)) {
    throw new InvalidApplicationManifestError(
      `${subject}.http must be an array`,
    );
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new InvalidApplicationManifestError(
        `${subject}.http must contain objects`,
      );
    }
    const method = entry.method;
    if (!HTTP_METHODS.includes(method as HttpMethod)) {
      throw new InvalidApplicationManifestError(
        `${subject}.http method must be one of ${HTTP_METHODS.join(", ")}`,
      );
    }
    const auth = entry.auth;
    if (!ROUTE_AUTH.includes(auth as RouteAuth)) {
      throw new InvalidApplicationManifestError(
        `${subject}.http auth must be one of ${ROUTE_AUTH.join(", ")}`,
      );
    }
    const path = assertString(entry, "path");
    if (!path.startsWith("/")) {
      throw new InvalidApplicationManifestError(
        `${subject}.http path must be absolute`,
      );
    }
    return {
      method: method as HttpMethod,
      path,
      action: assertString(entry, "action"),
      auth: auth as RouteAuth,
    };
  });
}

function parseWeb(value: unknown): WebSurfaceDefinition | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new InvalidApplicationManifestError("web must be an object or null");
  }
  const stringArray = (key: string): string[] => {
    const entries = value[key];
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => typeof entry !== "string")
    ) {
      throw new InvalidApplicationManifestError(
        `web.${key} must be a string array`,
      );
    }
    return entries as string[];
  };
  return {
    clientPackage: assertString(value, "clientPackage"),
    publicRoutes: stringArray("publicRoutes"),
    authenticatedRoutes: stringArray("authenticatedRoutes"),
  };
}

function parseModules(value: unknown): ManifestModule[] {
  if (!Array.isArray(value)) {
    throw new InvalidApplicationManifestError("modules must be an array");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new InvalidApplicationManifestError("modules must contain objects");
    }
    return {
      id: assertString(entry, "id"),
      version: assertString(entry, "version"),
      kernelRange: assertString(entry, "kernelRange"),
      actions: parseActions(entry.actions, `module ${String(entry.id)}`),
      http: parseRoutes(entry.http, `module ${String(entry.id)}`),
    };
  });
}

/**
 * Validates a manifest read back from storage. Persisted data is a trust
 * boundary: a malformed or edited row must fail boot, never be served.
 */
export function parseApplicationManifest(value: unknown): ApplicationManifest {
  if (!isRecord(value)) {
    throw new InvalidApplicationManifestError("expected an object");
  }
  if (value.schemaVersion !== APPLICATION_MANIFEST_SCHEMA_VERSION) {
    throw new InvalidApplicationManifestError(
      `unsupported schemaVersion ${String(value.schemaVersion)}`,
    );
  }
  const manifest: ApplicationManifest = {
    schemaVersion: APPLICATION_MANIFEST_SCHEMA_VERSION,
    id: assertString(value, "id"),
    name: assertString(value, "name"),
    version: assertString(value, "version"),
    actions: parseActions(value.actions, "application"),
    http: parseRoutes(value.http, "application"),
    web: parseWeb(value.web),
    modules: parseModules(value.modules),
  };
  return manifest;
}
