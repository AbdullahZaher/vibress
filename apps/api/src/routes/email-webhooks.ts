import { FastifyInstance } from 'fastify';
import { emailService } from '../services';
import { getConfig } from '@vibress/config';
import { appLogger } from '../observability';

/**
 * Email provider webhook endpoint.
 * Security: provider signature verification (NOT cookie auth).
 * Raw body preserved for signature verification via a scoped buffer parser.
 */
export async function emailWebhookRoutes(fastify: FastifyInstance) {
  fastify.register((instance, _opts, done) => {
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, next) => {
      next(null, body);
    });
    instance.addContentTypeParser('text/plain', { parseAs: 'buffer' }, (_req, body, next) => {
      next(null, body);
    });

    instance.post('/:provider', {
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

        const signatureHeader = (req.headers['x-email-signature'] as string | undefined) || null;

        try {
          const result = await emailService.handleWebhook(provider, rawBody, signatureHeader);
          return reply.status(result.status).send({ received: true });
        } catch (err: any) {
          appLogger.warn('email webhook processing failed', { event: 'email_webhook_processing_failed', provider, requestId: req.id }, err);
          return reply.status(200).send({ received: true, processing: 'failed, retryable' });
        }
      },
    });

    done();
  });
}
