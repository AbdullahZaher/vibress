import {
  asApplicationId,
  assertSemver,
  isPlatformIdentifier,
  type ApplicationId,
} from "./identity";
import type {
  AnyActionDefinition,
  ApplicationDefinition,
  HttpRouteDefinition,
  ModuleDefinition,
  WebSurfaceDefinition,
} from "./contracts";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const ROUTE_AUTH = ["public", "member", "staff", "service"] as const;
const PERMISSION_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const PATH_PARAM_PATTERN = /^:[a-zA-Z][a-zA-Z0-9_]*$/;
// Action names are developer-facing lowerCamelCase symbols, not entity IDs.
const ACTION_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{1,62}$/;

export class InvalidApplicationDefinitionError extends Error {
  readonly subject: string;

  constructor(subject: string, reason: string) {
    super(`${subject}: ${reason}`);
    this.name = "InvalidApplicationDefinitionError";
    this.subject = subject;
  }
}

export function defineAction<TInput, TOutput>(definition: {
  name: string;
  permission: string;
  input: (value: unknown) => TInput;
  handler: (context: {
    context: import("./contracts").RequestContext;
    input: TInput;
    transaction: import("./contracts").ActionTransaction;
    pathParameters: Readonly<Record<string, string>>;
  }) => Promise<TOutput>;
}): import("./contracts").ActionDefinition<TInput, TOutput> {
  if (!ACTION_NAME_PATTERN.test(definition.name)) {
    throw new InvalidApplicationDefinitionError(
      "action.name",
      "must be a lowerCamelCase action name",
    );
  }
  if (!PERMISSION_PATTERN.test(definition.permission)) {
    throw new InvalidApplicationDefinitionError(
      `action ${definition.name} permission`,
      "must be a dotted permission such as deals.approve",
    );
  }
  if (typeof definition.input !== "function") {
    throw new InvalidApplicationDefinitionError(
      `action ${definition.name} input`,
      "must be a runtime input parser",
    );
  }
  if (typeof definition.handler !== "function") {
    throw new InvalidApplicationDefinitionError(
      `action ${definition.name} handler`,
      "must be a function",
    );
  }
  return Object.freeze({
    name: definition.name,
    permission: definition.permission,
    input: definition.input,
    handler: definition.handler,
  });
}

export function defineRoute(definition: HttpRouteDefinition): HttpRouteDefinition {
  if (!HTTP_METHODS.includes(definition.method)) {
    throw new InvalidApplicationDefinitionError(
      "http.method",
      `must be one of ${HTTP_METHODS.join(", ")}`,
    );
  }
  if (
    typeof definition.path !== "string" ||
    !definition.path.startsWith("/") ||
    definition.path.includes("?") ||
    definition.path.includes("#")
  ) {
    throw new InvalidApplicationDefinitionError(
      "http.path",
      "must be an absolute path without query or fragment",
    );
  }
  for (const segment of definition.path.split("/").filter(Boolean)) {
    if (segment.startsWith(":") && !PATH_PARAM_PATTERN.test(segment)) {
      throw new InvalidApplicationDefinitionError(
        "http.path",
        `invalid path parameter segment ${segment}`,
      );
    }
  }
  if (!ACTION_NAME_PATTERN.test(definition.action)) {
    throw new InvalidApplicationDefinitionError(
      "http.action",
      "must be a declared action name",
    );
  }
  if (!ROUTE_AUTH.includes(definition.auth)) {
    throw new InvalidApplicationDefinitionError(
      "http.auth",
      `must be one of ${ROUTE_AUTH.join(", ")}`,
    );
  }
  return Object.freeze({ ...definition });
}

export function defineModule(definition: {
  id: string;
  version: string;
  kernelRange: string;
  actions?: Readonly<Record<string, AnyActionDefinition>>;
  http?: readonly HttpRouteDefinition[];
}): ModuleDefinition {
  if (!isPlatformIdentifier(definition.id)) {
    throw new InvalidApplicationDefinitionError(
      "module.id",
      "must be a lowercase platform identifier",
    );
  }
  assertSemver("module.version", definition.version);
  if (
    typeof definition.kernelRange !== "string" ||
    definition.kernelRange.trim() === ""
  ) {
    throw new InvalidApplicationDefinitionError(
      "module.kernelRange",
      "must declare a supported kernel range",
    );
  }
  const actions: Record<string, AnyActionDefinition> = {};
  for (const [name, action] of Object.entries(definition.actions ?? {})) {
    if (action.name !== name) {
      throw new InvalidApplicationDefinitionError(
        `module ${definition.id} action key`,
        `key ${name} does not match action name ${action.name}`,
      );
    }
    actions[name] = action;
  }
  const http = (definition.http ?? []).map(defineRoute);
  assertUniqueRoutes(http, `module ${definition.id}`);
  return Object.freeze({
    id: definition.id,
    version: definition.version,
    kernelRange: definition.kernelRange,
    actions: Object.freeze(actions),
    http: Object.freeze(http),
  });
}

function assertUniqueRoutes(
  routes: readonly HttpRouteDefinition[],
  subject: string,
): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      throw new InvalidApplicationDefinitionError(
        subject,
        `duplicate route ${key}`,
      );
    }
    seen.add(key);
  }
}

function assertWebSurface(web: WebSurfaceDefinition): void {
  if (
    typeof web.clientPackage !== "string" ||
    web.clientPackage.trim() === ""
  ) {
    throw new InvalidApplicationDefinitionError(
      "web.clientPackage",
      "must name the developer-owned client package",
    );
  }
  for (const route of [...web.publicRoutes, ...web.authenticatedRoutes]) {
    if (!route.startsWith("/")) {
      throw new InvalidApplicationDefinitionError(
        "web route",
        `must be an absolute path, received ${route}`,
      );
    }
  }
}

export function defineApplication(definition: {
  id: string | ApplicationId;
  name: string;
  version: string;
  actions?: Readonly<Record<string, AnyActionDefinition>>;
  http?: readonly HttpRouteDefinition[];
  web?: WebSurfaceDefinition;
  modules?: readonly ModuleDefinition[];
}): ApplicationDefinition {
  const id = asApplicationId(definition.id);
  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new InvalidApplicationDefinitionError(
      "application.name",
      "must be a non-empty string",
    );
  }
  assertSemver("application.version", definition.version);

  const actions: Record<string, AnyActionDefinition> = {};
  for (const [name, action] of Object.entries(definition.actions ?? {})) {
    if (action.name !== name) {
      throw new InvalidApplicationDefinitionError(
        "application action key",
        `key ${name} does not match action name ${action.name}`,
      );
    }
    actions[name] = action;
  }

  const modules = (definition.modules ?? []).map(defineModule);
  const moduleIds = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) {
      throw new InvalidApplicationDefinitionError(
        "application.modules",
        `duplicate module ${module.id}`,
      );
    }
    moduleIds.add(module.id);
    for (const [name, action] of Object.entries(module.actions)) {
      if (actions[name] && actions[name] !== action) {
        throw new InvalidApplicationDefinitionError(
          "application.actions",
          `module ${module.id} action ${name} collides with an application action`,
        );
      }
      actions[name] = action;
    }
  }

  const http = [
    ...(definition.http ?? []),
    ...modules.flatMap((module) => module.http),
  ].map(defineRoute);
  assertUniqueRoutes(http, "application");

  for (const route of http) {
    if (!actions[route.action]) {
      throw new InvalidApplicationDefinitionError(
        "application.http",
        `route ${route.method} ${route.path} references unknown action ${route.action}`,
      );
    }
  }

  if (definition.web) {
    assertWebSurface(definition.web);
  }

  return Object.freeze({
    id,
    name: definition.name,
    version: definition.version,
    actions: Object.freeze(actions),
    http: Object.freeze(http),
    ...(definition.web ? { web: Object.freeze(definition.web) } : {}),
    ...(modules.length > 0 ? { modules: Object.freeze(modules) } : {}),
  });
}

export function parseMajorMinorPatch(version: string): {
  major: number;
  minor: number;
  patch: number;
} {
  assertSemver("version", version);
  const [major, minor, patch] = version.split("-")[0]!.split(".").map(Number);
  return { major: major!, minor: minor!, patch: patch! };
}

/**
 * Small compatibility check for module admission. Supports exact versions,
 * caret ranges (`^1.2.3`) and lower bounds (`>=1.2.3`). A full semver
 * implementation is intentionally not hand-rolled; callers that need complex
 * ranges must introduce a reviewed dependency.
 */
export function isCompatibleKernel(
  kernelRange: string,
  actualVersion: string,
): boolean {
  const actual = parseMajorMinorPatch(actualVersion);
  const trimmed = kernelRange.trim();
  if (trimmed.startsWith("^")) {
    const required = parseMajorMinorPatch(trimmed.slice(1));
    return actual.major === required.major && actual.minor >= required.minor;
  }
  if (trimmed.startsWith(">=")) {
    const required = parseMajorMinorPatch(trimmed.slice(2));
    if (actual.major !== required.major) return actual.major > required.major;
    if (actual.minor !== required.minor) return actual.minor > required.minor;
    return actual.patch >= required.patch;
  }
  return trimmed === actualVersion;
}
