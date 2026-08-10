import { FastifyInstance } from 'fastify';
import { emailService } from '../services';

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
          max: process.env.NODE_ENV === 'test' ? 1000 : 600,
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
          req.log.warn({ event: 'email_webhook_processing_failed', provider }, err.message || 'processing failed');
          return reply.status(200).send({ received: true, processing: 'failed, retryable' });
        }
      },
    });

    done();
  });
}
