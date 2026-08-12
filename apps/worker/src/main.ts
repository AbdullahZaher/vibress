import './tracing-init';
import { getRedisClient, closeRedisClient } from '@vibress/cache';
import { closeDbPool } from '@vibress/database';
import { ContentSchedulerWorker } from './scheduler';
import { EmailDeliveryWorker } from './processors/email-delivery-worker';
import { WebhookDeliveryWorker } from './processors/webhook-delivery-worker';
import { AnalyticsWorker } from './processors/analytics-worker';
import { SearchIndexerWorker } from './processors/search-indexer-worker';
import { AutomationRunnerWorker } from './processors/automation-runner-worker';
import { AutomationActionExecutor } from './processors/automation-action-executor';
import { WorkerSearchContentSource } from './processors/search-content-source';
import { NewsletterSendSchedulerWorker } from './schedules/newsletter-send-scheduler';
import { closeEmailQueue } from './queues/email-queue';
import { createDefaultOutboxDispatcher } from './processors/outbox-dispatcher';
import { getConfig } from '@vibress/config';
import {
  createLogger,
  exportMetricsText,
  startEventLoopLagMonitor,
} from '@vibress/observability';
import http from 'http';

const connection = getRedisClient();
const config = getConfig();
const appLogger = createLogger('worker', { minLevel: 'info' });

// EVENT_DELIVERY_MODE=direct opts into the legacy in-process event relay
// (handled in apps/api); the outbox dispatcher is the durable path (default).
const outboxBroadcastEnabled = config.outbox.deliveryMode !== 'direct';

appLogger.info('Vibress Worker Initializing...');
const observabilityMonitors = startEventLoopLagMonitor();
const scheduler = new ContentSchedulerWorker();
scheduler.start(5000); // 5s sweep interval

const sendScheduler = new NewsletterSendSchedulerWorker();
sendScheduler.start(5000); // 5s sweep for due scheduled sends

const outboxDispatcher = outboxBroadcastEnabled ? createDefaultOutboxDispatcher() : null;
outboxDispatcher?.start(5000);

const emailDeliveryWorker = new EmailDeliveryWorker();
emailDeliveryWorker.start().catch((err) => {
  appLogger.error('[EmailWorker] Failed to start', {}, err as Error);
});

const webhookDeliveryWorker = new WebhookDeliveryWorker();
webhookDeliveryWorker.start().catch((err) => {
  appLogger.error('[WebhookWorker] Failed to start', {}, err as Error);
});

const analyticsWorker = new AnalyticsWorker();
analyticsWorker.start().catch((err) => {
  appLogger.error('[AnalyticsWorker] Failed to start', {}, err as Error);
});

const searchIndexerWorker = new SearchIndexerWorker(new WorkerSearchContentSource());
searchIndexerWorker.start().catch((err) => {
  appLogger.error('[SearchIndexer] Failed to start', {}, err as Error);
});

const automationRunnerWorker = new AutomationRunnerWorker(new AutomationActionExecutor());
automationRunnerWorker.start().catch((err) => {
  appLogger.error('[AutomationRunner] Failed to start', {}, err as Error);
});

const port = config.ports.workerHealth;

const server = http.createServer((req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.url === '/health/ready') {
    if (connection.status === 'ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_ready', checks: { redis: connection.status } }));
    }
  } else if (req.url === '/metrics' && config.observability.metricsEnabled) {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(exportMetricsText());
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  appLogger.info(`Worker health server listening on port ${port}`);
});

const shutdown = async (signal: string) => {
  appLogger.info(`Worker received ${signal}. Shutting down gracefully...`);
  try {
    observabilityMonitors.stop();
    scheduler.stop();
    sendScheduler.stop();
    outboxDispatcher?.stop();
    await emailDeliveryWorker.stop();
    await webhookDeliveryWorker.stop();
    await analyticsWorker.stop();
    await searchIndexerWorker.stop();
    await automationRunnerWorker.stop();
    await closeEmailQueue();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    await closeRedisClient();
    await closeDbPool();
    const { tracingHandle } = await import('./tracing-init');
    await tracingHandle.stop();
    appLogger.info('Worker closed remaining connections.');
    process.exit(0);
  } catch (err) {
    appLogger.error('Error during worker shutdown', {}, err as Error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
