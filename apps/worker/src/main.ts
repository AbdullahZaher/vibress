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
import http from 'http';

const connection = getRedisClient();

console.log('Vibress Worker Initializing...');
const scheduler = new ContentSchedulerWorker();
scheduler.start(5000); // 5s sweep interval

const sendScheduler = new NewsletterSendSchedulerWorker();
sendScheduler.start(5000); // 5s sweep for due scheduled sends

const emailDeliveryWorker = new EmailDeliveryWorker();
emailDeliveryWorker.start().catch((err) => {
  console.error('[EmailWorker] Failed to start:', err.message || err);
});

const webhookDeliveryWorker = new WebhookDeliveryWorker();
webhookDeliveryWorker.start().catch((err) => {
  console.error('[WebhookWorker] Failed to start:', err.message || err);
});

const analyticsWorker = new AnalyticsWorker();
analyticsWorker.start().catch((err) => {
  console.error('[AnalyticsWorker] Failed to start:', err.message || err);
});

const searchIndexerWorker = new SearchIndexerWorker(new WorkerSearchContentSource());
searchIndexerWorker.start().catch((err) => {
  console.error('[SearchIndexer] Failed to start:', err.message || err);
});

const automationRunnerWorker = new AutomationRunnerWorker(new AutomationActionExecutor());
automationRunnerWorker.start().catch((err) => {
  console.error('[AutomationRunner] Failed to start:', err.message || err);
});

const port = process.env.WORKER_HEALTH_PORT ? parseInt(process.env.WORKER_HEALTH_PORT) : 7782;

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
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, () => {
  console.log(`Worker health server listening on port ${port}`);
});

const shutdown = async (signal: string) => {
  console.log(`Worker received ${signal}. Shutting down gracefully...`);
  try {
    scheduler.stop();
    sendScheduler.stop();
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
    console.log('Worker closed remaining connections.');
    process.exit(0);
  } catch (err) {
    console.error('Error during worker shutdown', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
