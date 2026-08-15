import { getConfig } from "@vibress/config";
import { initTracing } from "@vibress/observability";

export const tracingHandle = initTracing({
  enabled: getConfig().observability.tracingEnabled,
  serviceName: "vibress-api",
  serviceVersion: getConfig().system.version,
  otlpEndpoint: getConfig().observability.tracing.otlpEndpoint,
  otlpHeaders: getConfig().observability.tracing.otlpHeaders,
  samplingRatio: getConfig().observability.tracing.samplingRatio,
  resourceAttributes: getConfig().observability.tracing.resourceAttributes,
});
