import type {
  ApplicationId,
  InstallationId,
  PrincipalId,
  TenantId,
} from "./identity";

export type PrincipalKind =
  | "end_user"
  | "staff"
  | "operator"
  | "service";

export type ExecutionSurface =
  | "http"
  | "worker"
  | "websocket"
  | "cli"
  | "migration"
  | "operator";

/**
 * A principal is always resolved on the server. A request may carry an opaque
 * session/key identifier, but it may never supply a trusted principal object.
 */
export interface VerifiedPrincipal {
  readonly id: PrincipalId;
  readonly kind: PrincipalKind;
  readonly applicationId: ApplicationId;
  readonly tenantIds: readonly TenantId[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface RequestContext {
  readonly requestId: string;
  readonly applicationId: ApplicationId;
  readonly installationId: InstallationId;
  readonly tenantId: TenantId | null;
  readonly principal: VerifiedPrincipal | null;
  readonly surface: ExecutionSurface;
}

export type PolicyEffect = "allow" | "deny";

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason: string;
  readonly matchedRuleId?: string | undefined;
}

export interface DomainEvent<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly applicationId: ApplicationId;
  readonly tenantId: TenantId | null;
  readonly payload: TPayload;
}

/**
 * Minimal transaction surface exposed to trusted application code. It cannot
 * create connections, switch tenant scope, or escape to privileged
 * infrastructure; the runtime owns both the connection and the tenant context.
 */
export interface ActionTransaction {
  query<TRow = unknown>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

export interface ActionContext<TInput> {
  readonly context: RequestContext;
  readonly input: TInput;
  readonly transaction: ActionTransaction;
  readonly pathParameters: Readonly<Record<string, string>>;
}

export type InputParser<T> = (value: unknown) => T;

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly permission: string;
  readonly input: InputParser<TInput>;
  readonly handler: (context: ActionContext<TInput>) => Promise<TOutput>;
}

export type AnyActionDefinition = ActionDefinition<any, any>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteAuth = "public" | "member" | "staff" | "service";

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly action: string;
  readonly auth: RouteAuth;
}

export interface WebSurfaceDefinition {
  readonly clientPackage: string;
  readonly publicRoutes: readonly string[];
  readonly authenticatedRoutes: readonly string[];
}

export interface ModuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly kernelRange: string;
  readonly actions: Readonly<Record<string, AnyActionDefinition>>;
  readonly http: readonly HttpRouteDefinition[];
}

export interface ApplicationDefinition {
  readonly id: ApplicationId;
  readonly name: string;
  readonly version: string;
  readonly actions: Readonly<Record<string, AnyActionDefinition>>;
  readonly http: readonly HttpRouteDefinition[];
  readonly web?: WebSurfaceDefinition | undefined;
  readonly modules?: readonly ModuleDefinition[] | undefined;
}

export interface ActionResolution {
  readonly application: ApplicationDefinition;
  readonly action: AnyActionDefinition;
}
