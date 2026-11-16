import { asApplicationId, type ApplicationId } from "./identity";
import type {
  ActionResolution,
  ApplicationDefinition,
  HttpMethod,
  HttpRouteDefinition,
} from "./contracts";
import { isCompatibleKernel } from "./application";

export interface RouteResolution extends ActionResolution {
  readonly route: HttpRouteDefinition;
  readonly pathParameters: Readonly<Record<string, string>>;
}

export interface ApplicationRegistry {
  register(application: ApplicationDefinition): void;
  get(id: ApplicationId | string): ApplicationDefinition | undefined;
  list(): readonly ApplicationDefinition[];
  resolveAction(
    applicationId: ApplicationId | string,
    actionName: string,
  ): ActionResolution | undefined;
  resolveRoute(
    method: HttpMethod,
    path: string,
  ): RouteResolution | undefined;
}

export class DuplicateApplicationError extends Error {
  constructor(id: string) {
    super(`Application ${id} is already registered`);
    this.name = "DuplicateApplicationError";
  }
}

export class InMemoryApplicationRegistry implements ApplicationRegistry {
  readonly #applications = new Map<string, ApplicationDefinition>();

  constructor(
    applications: readonly ApplicationDefinition[] = [],
    kernelVersion = "1.2.0",
  ) {
    for (const application of applications) {
      this.register(application, kernelVersion);
    }
  }

  register(application: ApplicationDefinition, kernelVersion = "1.2.0"): void {
    if (this.#applications.has(application.id)) {
      throw new DuplicateApplicationError(application.id);
    }
    for (const module of application.modules ?? []) {
      if (!isCompatibleKernel(module.kernelRange, kernelVersion)) {
        throw new Error(
          `Module ${module.id} requires kernel ${module.kernelRange}, running ${kernelVersion}`,
        );
      }
    }
    this.#applications.set(application.id, application);
  }

  get(id: ApplicationId | string): ApplicationDefinition | undefined {
    return this.#applications.get(asApplicationId(id));
  }

  list(): readonly ApplicationDefinition[] {
    return Object.freeze([...this.#applications.values()]);
  }

  resolveAction(
    applicationId: ApplicationId | string,
    actionName: string,
  ): ActionResolution | undefined {
    const application = this.get(applicationId);
    const action = application?.actions[actionName];
    if (!application || !action) return undefined;
    return { application, action };
  }

  resolveRoute(
    method: HttpMethod,
    path: string,
  ): RouteResolution | undefined {
    const normalized = normalizePath(path);
    for (const application of this.#applications.values()) {
      for (const route of application.http) {
        if (route.method !== method) continue;
        const parameters = matchPath(route.path, normalized);
        if (!parameters) continue;
        const action = application.actions[route.action];
        if (!action) continue;
        return { application, route, action, pathParameters: parameters };
      }
    }
    return undefined;
  }
}

function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function matchPath(
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | null {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;
  const parameters: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    const actual = pathSegments[index]!;
    if (expected.startsWith(":")) {
      parameters[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return Object.freeze(parameters);
}
