import { Job } from '@vibress/queue';
import { withSpan, withRemoteTraceContext } from '@vibress/observability';

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

/**
 * Wraps a BullMQ processor so each job runs inside an OpenTelemetry span. When
 * the job carries a W3C traceparent (written by enqueueTraced), the span
 * continues the producing process's trace.
 */
export function tracedProcessor<T extends { traceparent?: string }>(
  spanName: string,
  process: (job: Job<T>) => Promise<void>
): (job: Job<T>) => Promise<void> {
  return (job) => {
    const tp = job.data.traceparent;
    const traceCtx =
      typeof tp === 'string' && TRACEPARENT_RE.test(tp)
        ? { traceId: tp.slice(3, 35), spanId: tp.slice(36, 52) }
        : undefined;
    return withRemoteTraceContext(traceCtx, () =>
      withSpan(
        spanName,
        () => process(job),
        {
          'messaging.system': 'bullmq',
          'messaging.operation': 'process',
          'messaging.destination': job.queueName,
          'messaging.message.id': job.id ?? '',
          ...(traceCtx ? { 'vibress.trace_id': traceCtx.traceId } : {}),
        }
      )
    );
  };
}
