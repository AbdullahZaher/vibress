import { FastifyInstance, FastifyReply } from 'fastify';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import {
  newslettersService,
  emailService,
  newsletterSendEnqueuer,
} from '../services';
import {
  AdminNewsletterInputSchema,
  AdminNewsletterSendInputSchema,
  AdminTestEmailInputSchema,
} from '@vibress/api-contracts';
import { NewsletterDomainError, UpdateNewsletterData, NewsletterSend, SendStatus } from '@vibress/newsletters';
import { EmailDomainError, EmailProviderError, SuppressionReason } from '@vibress/email';
import { DrizzleEmailRecipientRepository } from '@vibress/email';

const recipientRepo = new DrizzleEmailRecipientRepository();

const zNewsletterAudience = AdminNewsletterSendInputSchema.pick({ newsletterId: true, audience: true });

type NewsletterListQuery = { includeArchived?: string };
type NewsletterSendListQuery = { status?: string; newsletterId?: string; limit?: string; offset?: string };
type EmailSuppressionListQuery = { limit?: string; offset?: string };

export async function adminNewsletterRoutes(fastify: FastifyInstance) {
  const sendError = (reply: FastifyReply, code: string, message: string, requestId: string, status = 400) =>
    reply.status(status).send({ errors: [{ code, message, requestId }] });

  // ---------------- Newsletters ----------------
  fastify.get('/newsletters', {
    preHandler: [requireStaffSession, requirePermission('newsletters.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as NewsletterListQuery;
      const includeArchived = String(query.includeArchived) === 'true';
      const newsletters = await newslettersService.listNewsletters({ includeArchived });
      return reply.status(200).send({ newsletters });
    },
  });

  fastify.post('/newsletters', {
    preHandler: [requireStaffSession, requirePermission('newsletters.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminNewsletterInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid newsletter payload', req.id);
      try {
        const newsletter = await newslettersService.createNewsletter(parsed.data, req.user!.id);
        return reply.status(201).send({ newsletter });
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/newsletters/:id', {
    preHandler: [requireStaffSession, requirePermission('newsletters.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = AdminNewsletterInputSchema.omit({ key: true }).partial().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid newsletter payload', req.id);
      try {
        const newsletter = await newslettersService.updateNewsletter(id, parsed.data as UpdateNewsletterData, req.user!.id);
        return reply.status(200).send({ newsletter });
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/newsletters/:id/archive', {
    preHandler: [requireStaffSession, requirePermission('newsletters.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const newsletter = await newslettersService.archiveNewsletter(id, req.user!.id);
        return reply.status(200).send({ newsletter });
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  // ---------------- Sends ----------------
  fastify.get('/newsletter-sends', {
    preHandler: [requireStaffSession, requirePermission('newsletters.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as NewsletterSendListQuery;
      const params: { status?: SendStatus; newsletterId?: string; limit: number; offset: number } = {
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      };
      if (query.status) params.status = query.status as SendStatus;
      if (query.newsletterId) params.newsletterId = query.newsletterId;
      const result = await newslettersService.listSends(params);
      return reply.status(200).send(result);
    },
  });

  fastify.get('/newsletter-sends/:id', {
    preHandler: [requireStaffSession, requirePermission('newsletters.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const send = await newslettersService.getSend(id);
      if (!send) return sendError(reply, 'SEND_NOT_FOUND', 'Send not found', req.id, 404);
      const counts = await recipientRepo.countByStatus(id);
      return reply.status(200).send({ send, counts });
    },
  });

  fastify.post('/newsletter-sends', {
    preHandler: [requireStaffSession, requirePermission('newsletters.send'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminNewsletterSendInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid send payload', req.id);
      const { newsletterId, subject, content, audience, scheduledAt, sendNow } = parsed.data;
      const audienceDefinition = {
        filter: audience.filter,
        productId: audience.productId ?? null,
        planId: audience.planId ?? null,
      };

      const newsletter = await newslettersService.getNewsletter(newsletterId);
      if (!newsletter) return sendError(reply, 'NEWSLETTER_NOT_FOUND', 'Newsletter not found', req.id, 404);

      // Audience summary for the response
      const audienceCount = (await newslettersService.computeAudience(newsletterId, audienceDefinition)).length;

      try {
        const send = await newslettersService.createSend({
          newsletterId,
          subject,
          content,
          audience: audienceDefinition,
          senderName: newsletter.senderName,
          senderEmail: newsletter.senderEmail,
          replyTo: newsletter.replyTo,
          scheduledAt: sendNow ? new Date() : scheduledAt ? new Date(scheduledAt) : null,
          status: sendNow ? 'draft' : scheduledAt ? 'scheduled' : 'draft',
        }, req.user!.id);

        if (sendNow) {
          // Enqueue immediately; worker processes asynchronously
          await newsletterSendEnqueuer.startSendAndEnqueue(send.id);
        }

        return reply.status(201).send({ send, audienceCount });
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/newsletter-sends/:id/send-now', {
    preHandler: [requireStaffSession, requirePermission('newsletters.send'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const result = await newsletterSendEnqueuer.startSendAndEnqueue(id);
        return reply.status(200).send(result);
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/newsletter-sends/:id/cancel', {
    preHandler: [requireStaffSession, requirePermission('newsletters.send'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const send = await newslettersService.cancelSend(id);
        return reply.status(200).send({ send });
      } catch (err) {
        if (err instanceof NewsletterDomainError) return sendError(reply, err.code, err.message, req.id, 400);
        throw err;
      }
    },
  });

  // ---------------- Test email ----------------
  fastify.post('/newsletter-test-email', {
    preHandler: [requireStaffSession, requirePermission('newsletters.send'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminTestEmailInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid test email payload', req.id);
      const { newsletterId, subject, content, recipients } = parsed.data;

      const newsletter = await newslettersService.getNewsletter(newsletterId);
      if (!newsletter) return sendError(reply, 'NEWSLETTER_NOT_FOUND', 'Newsletter not found', req.id, 404);

      // Build a pseudo-send for rendering
      const pseudoSend = {
        id: `test-${Date.now()}`,
        newsletterId,
        subject,
        contentVersion: 1,
        content,
        senderName: newsletter.senderName,
        senderEmail: newsletter.senderEmail,
        replyTo: newsletter.replyTo,
      } as NewsletterSend;

      const results: Array<{ email: string; messageId: string | null; error: string | null }> = [];
      for (const to of recipients) {
        try {
          const { html, text } = newslettersService.renderEmailHtml(pseudoSend, 'test', 'test-token');
          const result = await emailService.sendDirect({
            to,
            toName: null,
            from: newsletter.senderEmail,
            fromName: newsletter.senderName,
            replyTo: newsletter.replyTo,
            subject,
            html,
            text,
          });
          results.push({ email: to, messageId: result.messageId, error: null });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'send failed';
          results.push({ email: to, messageId: null, error: message || 'send failed' });
        }
      }

      const failed = results.filter((r) => r.error);
      return reply.status(failed.length === 0 ? 200 : 207).send({ results, sent: results.length - failed.length, failed: failed.length });
    },
  });

  // ---------------- Audience summary ----------------
  fastify.post('/newsletter-audience-summary', {
    preHandler: [requireStaffSession, requirePermission('newsletters.send'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = zNewsletterAudience.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid audience payload', req.id);
      const definition = {
        filter: parsed.data.audience.filter,
        productId: parsed.data.audience.productId ?? null,
        planId: parsed.data.audience.planId ?? null,
      };
      const count = (await newslettersService.computeAudience(parsed.data.newsletterId, definition)).length;
      return reply.status(200).send({ count });
    },
  });

  // ---------------- Suppressions ----------------
  fastify.get('/email-suppressions', {
    preHandler: [requireStaffSession, requirePermission('email.read')],
    handler: async (req, reply) => {
      const query = (req.query ?? {}) as EmailSuppressionListQuery;
      const result = await emailService.listSuppressions(
        query.limit ? parseInt(query.limit, 10) : 50,
        query.offset ? parseInt(query.offset, 10) : 0
      );
      return reply.status(200).send(result);
    },
  });

  fastify.delete('/email-suppressions/:id', {
    preHandler: [requireStaffSession, requirePermission('email.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const list = await emailService.listSuppressions(100, 0);
      const target = (list.suppressions as Array<{ id: string; email: string; reason: SuppressionReason }>).find((s) => s.id === id);
      if (!target) return sendError(reply, 'SUPPRESSION_NOT_FOUND', 'Suppression not found', req.id, 404);
      await emailService.removeSuppression(target.email, target.reason);
      return reply.status(200).send({ success: true });
    },
  });
}
