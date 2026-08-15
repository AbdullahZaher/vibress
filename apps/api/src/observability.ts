import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createLogger,
  exportMetricsText,
  metrics,
  setRequestTraceContext,
  startEventLoopLagMonitor,
} from "@vibress/observability";
import type { LogLevel } from "@vibress/observability";
import { getConfig } from "@vibress/config";

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export function createApiLogger(): ReturnType<typeof createLogger> {
  const configuredLevel = getConfig().logLevel as LogLevel;
  const minLevel = VALID_LOG_LEVELS.includes(configuredLevel)
    ? configuredLevel
    : "info";
  return createLogger("api", { minLevel });
}

export const appLogger = createApiLogger();

const TRACEPARENT_RE =
  /^([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function extractTraceId(request: FastifyRequest): string | undefined {
  const header = request.headers["traceparent"];
  if (typeof header !== "string") return undefined;
  const match = header.trim().match(TRACEPARENT_RE);
  if (match) return match[1];
  return undefined;
}

function requestPath(request: FastifyRequest): string {
  const routeUrl = (request.routeOptions as { url?: string } | undefined)
    ?.url as string | undefined;
  if (routeUrl) return routeUrl;
  const rawPath = request.url.split("?")[0];
  return rawPath || request.url;
}

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

function recordRequestMetrics(
  request: FastifyRequest,
  statusCode: number,
): void {
  metrics.counter("http_requests_total", 1, {
    method: request.method,
    path: requestPath(request),
    status: statusClass(statusCode),
  });
}

export function registerTraceHooks(app: FastifyInstance): void {
  const { tracingEnabled } = getConfig().observability;

  app.addHook("onRequest", (request, reply, done) => {
    (request as unknown as { startTime: number }).startTime = performance.now();
    if (!tracingEnabled) return done();

    const traceId = extractTraceId(request);
    const context: Record<string, string | undefined> = {
      requestId: request.id,
      method: request.method,
      path: request.url.split("?")[0],
      ipAddress: request.ip,
      ...(traceId ? { traceId } : {}),
    };
    setRequestTraceContext(
      context as Parameters<typeof setRequestTraceContext>[0],
      async () => {
        done();
      },
    );
  });

  app.addHook("onResponse", (request, reply, done) => {
    const startTime = (request as unknown as { startTime?: number }).startTime;
    appLogger.info("request completed", {
      method: request.method,
      path: requestPath(request),
      statusCode: reply.statusCode,
      durationMs: startTime
        ? Math.round(performance.now() - startTime)
        : undefined,
      requestId: request.id,
    });
    if (getConfig().observability.metricsEnabled) {
      recordRequestMetrics(request, reply.statusCode);
    }
    done();
  });
}

export function registerMetricsRoutes(app: FastifyInstance): void {
  if (!getConfig().observability.metricsEnabled) return;

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return exportMetricsText();
  });
}

export function recordHttpError(statusCode: number, code: string): void {
  if (!getConfig().observability.metricsEnabled) return;
  metrics.counter("http_errors_total", 1, {
    code: `${statusCode < 500 ? statusCode : "5xx"}:${code}`,
  });
}

export function startObservabilityMonitors(): { stop: () => void } {
  return startEventLoopLagMonitor(1000);
}
