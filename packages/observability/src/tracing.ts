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

/**
 * Returns the active sampled trace context ({ traceId, spanId }) when tracing
 * is enabled and a span is active, or undefined. Used to propagate trace
 * context across process boundaries (outbox envelope, queue job metadata).
 */
export function getActiveTraceContext():
  { traceId: string; spanId: string } | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const spanContext = span.spanContext();
  if (spanContext.traceFlags !== TraceFlags.SAMPLED) return undefined;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

/**
 * Runs fn inside a context whose active span is the remote parent described
 * by the given trace context (e.g. from an outbox envelope or queue job
 * written by another process). Safe no-op when the trace context is invalid.
 */
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
