import { FastifyInstance } from 'fastify';
import { billingService } from '../services';
import { getConfig } from '@vibress/config';
import { appLogger } from '../observability';

/**
 * Billing webhook endpoint.
 * Security: provider signature verification (NOT cookie auth).
 * The raw body is preserved for signature verification via a scoped
 * buffer content-type parser (no JSON parse/re-serialize before verification).
 */
export async function billingWebhookRoutes(fastify: FastifyInstance) {
  fastify.register((instance, _opts, done) => {
    // Scoped to /api/webhooks/v1 — parses JSON as raw Buffer so signature
    // verification happens on the exact received bytes.
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, next) => {
      next(null, body);
    });
    instance.addContentTypeParser('text/plain', { parseAs: 'buffer' }, (_req, body, next) => {
      next(null, body);
    });

    instance.post('/billing/:provider', {
      config: {
        rateLimit: {
          max: getConfig().isTest ? 1000 : 600,
          timeWindow: '1 minute',
        },
      },
      handler: async (req, reply) => {
        const { provider } = req.params as { provider: string };
        const rawBody = req.body as Buffer | undefined;
        if (!rawBody || rawBody.length === 0) {
          return reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Missing payload', requestId: req.id }] });
        }
        if (rawBody.length > 262144) {
          return reply.status(413).send({ errors: [{ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large', requestId: req.id }] });
        }

        const signatureHeader = (req.headers['stripe-signature'] as string | undefined) || null;

        try {
          const result = await billingService.handleWebhook(provider, rawBody, signatureHeader);
          // Safe acknowledgement: processing is synchronous and durable before ACK
          return reply.status(result.status).send({ received: true });
        } catch (err) {
          // Event was persisted; failed processing is retryable from the event record
          appLogger.warn(
            'webhook processing failed',
            { event: 'webhook_processing_failed', provider, requestId: req.id },
            err instanceof Error ? err : undefined
          );
          return reply.status(200).send({ received: true, processing: 'failed, retryable' });
        }
      },
    });

    done();
  });
}
