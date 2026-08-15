import { AsyncLocalStorage } from "node:async_hooks";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { trace, context, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { Span, Attributes, SpanContext } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

export interface TracingOptions {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint: string;
  otlpHeaders?: Record<string, string>;
  samplingRatio?: number;
  resourceAttributes?: Record<string, string>;
}

export interface TracingStopHandle {
  stop: () => Promise<void>;
}

export function initTracing(options: TracingOptions): TracingStopHandle {
  if (!options.enabled) {
    return { stop: async () => undefined };
  }

  const endpoint = options.otlpEndpoint.replace(/\/+$/, "");
  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    timeoutMillis: 2000,
    ...(options.otlpHeaders ? { headers: options.otlpHeaders } : {}),
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion || "0.0.0",
    ...options.resourceAttributes,
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter,
        exportTimeoutMillis: 2000,
        maxQueueSize: 1024,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
      }),
    ],
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  try {
    sdk.start();
  } catch (error) {
    console.error(
      "[tracing] failed to start OpenTelemetry SDK, continuing without tracing:",
      error,
    );
  }

  return {
    stop: async () => {
      try {
        await sdk.shutdown();
      } catch (error) {
        console.error("[tracing] error during OpenTelemetry shutdown:", error);
      }
    },
  };
}

export function getTracer(
  name = "vibress",
): ReturnType<typeof trace.getTracer> {
  return trace.getTracer(name);
}

export async function withSpan<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = getTracer("vibress");
  return tracer.startActiveSpan(spanName, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getActiveTraceContext():
  { traceId: string; spanId: string } | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const spanContext = span.spanContext();
  if (spanContext.traceFlags !== TraceFlags.SAMPLED) return undefined;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function withRemoteTraceContext<T>(
  traceCtx: { traceId: string; spanId: string } | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceCtx) return fn();
  const spanContext: SpanContext = {
    traceId: traceCtx.traceId,
    spanId: traceCtx.spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  };
  if (!trace.isSpanContextValid(spanContext)) return fn();
  const parent = trace.setSpanContext(context.active(), spanContext);
  return context.with(parent, fn);
}

export interface RequestTraceContext {
  requestId?: string;
  traceId?: string;
  actorId?: string | null;
  actorType?: "staff" | "member" | "system" | null;
  path?: string;
  method?: string;
  ipAddress?: string | null;
}

const traceStorage = new AsyncLocalStorage<RequestTraceContext>();

export function setRequestTraceContext<T>(
  context: RequestTraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(context, fn);
}

export function getRequestTraceContext(): RequestTraceContext | undefined {
  return traceStorage.getStore();
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  name?: string;
  minLevel?: LogLevel;
  redactKeys?: string[];
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private name: string;
  private minLevelNum: number;
  private redactKeys: Set<string>;

  constructor(options: LoggerOptions = {}) {
    this.name = options.name || "app";
    this.minLevelNum = LOG_LEVEL_ORDER[options.minLevel || "info"];
    this.redactKeys = new Set(
      (
        options.redactKeys || [
          "password",
          "passwordHash",
          "token",
          "secret",
          "authorization",
          "cookie",
          "x-vibress-setup-token",
          "setup-token",
        ]
      ).map((k) => k.toLowerCase()),
    );
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= this.minLevelNum;
  }

  private redact(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.redact(item));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (this.redactKeys.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redact(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
    err?: Error,
  ): void {
    if (!this.shouldLog(level)) return;

    const trace = getRequestTraceContext() || {};
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      ...(trace.requestId ? { requestId: trace.requestId } : {}),
      ...(trace.traceId ? { traceId: trace.traceId } : {}),
      ...(trace.actorId ? { actorId: trace.actorId } : {}),
      ...(meta ? (this.redact(meta) as Record<string, unknown>) : {}),
    };

    if (err) {
      entry["error"] = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    const output = JSON.stringify(entry);
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>, err?: Error): void {
    this.log("warn", message, meta, err);
  }

  error(message: string, meta?: Record<string, unknown>, err?: Error): void {
    this.log("error", message, meta, err);
  }
}

export function createLogger(name: string, options?: LoggerOptions): Logger {
  return new Logger({ ...options, name });
}

export interface MetricEntry {
  name: string;
  type: "counter" | "gauge";
  value: number;
  tags?: Record<string, string>;
}

class SimpleMetricsRegistry {
  private metrics = new Map<string, MetricEntry>();

  counter(name: string, value = 1, tags?: Record<string, string>): void {
    const key = `${name}:${JSON.stringify(tags || {})}`;
    const existing = this.metrics.get(key);
    if (existing) {
      existing.value += value;
    } else {
      const entry: MetricEntry = { name, type: "counter", value };
      if (tags !== undefined) entry.tags = tags;
      this.metrics.set(key, entry);
    }
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = `${name}:${JSON.stringify(tags || {})}`;
    const entry: MetricEntry = { name, type: "gauge", value };
    if (tags !== undefined) entry.tags = tags;
    this.metrics.set(key, entry);
  }

  getMetrics(): MetricEntry[] {
    return Array.from(this.metrics.values());
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const metrics = new SimpleMetricsRegistry();

export function collectProcessMetrics(): void {
  const memory = process.memoryUsage();
  metrics.gauge("nodejs_process_uptime_seconds", process.uptime());
  metrics.gauge("nodejs_process_memory_rss_bytes", memory.rss);
  metrics.gauge("nodejs_process_memory_heap_used_bytes", memory.heapUsed);
  metrics.gauge("nodejs_process_memory_heap_total_bytes", memory.heapTotal);
}

export interface StopHandle {
  stop: () => void;
}

export function startEventLoopLagMonitor(intervalMs = 1000): StopHandle {
  const timer = setInterval(() => {
    const start = performance.now();
    setImmediate(() => {
      metrics.gauge(
        "nodejs_event_loop_lag_seconds",
        (performance.now() - start) / 1000,
      );
    });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, "_");
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

export function exportMetricsText(): string {
  collectProcessMetrics();

  const lines: string[] = [];
  const entries = metrics.getMetrics().sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return JSON.stringify(a.tags || {}).localeCompare(
      JSON.stringify(b.tags || {}),
    );
  });

  let currentName: string | null = null;
  for (const entry of entries) {
    if (entry.name !== currentName) {
      currentName = entry.name;
      const seriesName = sanitizeSeriesName(entry.name, entry.type);
      lines.push(`# HELP ${seriesName} ${sanitizeMetricName(entry.name)}`);
      lines.push(`# TYPE ${seriesName} ${entry.type}`);
    }
    const labels = entry.tags
      ? Object.entries(entry.tags)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
          .join(",")
      : "";
    const seriesName = sanitizeSeriesName(entry.name, entry.type);
    lines.push(`${seriesName}${labels ? `{${labels}}` : ""} ${entry.value}`);
  }

  return lines.join("\n") + "\n";
}

function sanitizeSeriesName(name: string, type: "counter" | "gauge"): string {
  const sanitized = sanitizeMetricName(name);
  if (type === "counter" && !sanitized.endsWith("_total"))
    return `${sanitized}_total`;
  return sanitized;
}
