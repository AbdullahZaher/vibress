import { FastifyInstance } from 'fastify';
import { MemberCheckoutRequestSchema } from '@vibress/api-contracts';
import { billingService, subscriptionsService, plansService, productsService } from '../services';
import { requireMemberSession, validateMemberOrigin } from '../middleware/member-auth';
import { BillingDomainError } from '@vibress/billing';
import { SubscriptionDomainError, Subscription } from '@vibress/subscriptions';
import { getConfig } from '@vibress/config';

function formatSubscriptionDto(sub: Subscription, planName: string) {
  return {
    id: sub.id,
    productId: sub.productId,
    planId: sub.planId,
    planName,
    status: sub.status,
    currency: sub.currency,
    amountMinor: sub.amountMinor,
    billingInterval: sub.billingInterval,
    intervalCount: sub.intervalCount,
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    createdAt: sub.createdAt.toISOString(),
  };
}

export async function memberBillingRoutes(fastify: FastifyInstance) {
  // List member's subscriptions
  fastify.get('/subscriptions', {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const memberId = req.member!.id;
      const { subscriptions } = await subscriptionsService.listSubscriptions({ memberId, limit: 50 });
      const plans = new Map<string, string>();
      for (const sub of subscriptions) {
        const plan = await plansService.getPlan(sub.planId);
        plans.set(sub.planId, plan?.name || 'Plan');
      }
      return reply.status(200).send({
        subscriptions: subscriptions.map((s) => formatSubscriptionDto(s, plans.get(s.planId) || 'Plan')),
      });
    },
  });

  // Subscription detail (ownership enforced)
  fastify.get('/subscriptions/:id', {
    preHandler: [requireMemberSession],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = await subscriptionsService.getSubscription(id);
      if (!sub || sub.memberId !== req.member!.id) {
        return reply.status(404).send({
          errors: [{ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found', requestId: req.id }],
        });
      }
      const plan = await plansService.getPlan(sub.planId);
      return reply.status(200).send({ subscription: formatSubscriptionDto(sub, plan?.name || 'Plan') });
    },
  });

  // Create checkout session
  fastify.post('/billing/checkout', {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 100 : 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const parseResult = MemberCheckoutRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid checkout payload', requestId: req.id }],
        });
      }
      const { planId, offerKey } = parseResult.data;

      try {
        const result = await billingService.createCheckoutSession(req.member!.id, planId, offerKey);
        return reply.status(200).send({ checkoutUrl: result.checkoutUrl });
      } catch (err) {
        if (err instanceof BillingDomainError) {
          const status = err.code === 'BILLING_AUTH_REQUIRED' ? 401 : 400;
          return reply.status(status).send({
            errors: [{ code: err.code, message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Billing portal session
  fastify.post('/billing/portal', {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 100 : 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      try {
        const result = await billingService.createBillingPortalSession(req.member!.id);
        return reply.status(200).send({ url: result.url });
      } catch (err) {
        if (err instanceof BillingDomainError) {
          return reply.status(400).send({
            errors: [{ code: err.code, message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Cancel subscription at period end (ownership enforced)
  fastify.post('/subscriptions/:id/cancel', {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 100 : 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = await subscriptionsService.getSubscription(id);
      if (!sub || sub.memberId !== req.member!.id) {
        return reply.status(404).send({
          errors: [{ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found', requestId: req.id }],
        });
      }

      try {
        const updated = await subscriptionsService.cancelAtPeriodEnd(id);
        const plan = await plansService.getPlan(updated.planId);
        return reply.status(200).send({ subscription: formatSubscriptionDto(updated, plan?.name || 'Plan') });
      } catch (err) {
        if (err instanceof SubscriptionDomainError) {
          return reply.status(400).send({
            errors: [{ code: err.code, message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Resume scheduled cancellation (ownership enforced)
  fastify.post('/subscriptions/:id/resume', {
    config: {
      rateLimit: {
        max: getConfig().isTest ? 100 : 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [requireMemberSession, validateMemberOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = await subscriptionsService.getSubscription(id);
      if (!sub || sub.memberId !== req.member!.id) {
        return reply.status(404).send({
          errors: [{ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found', requestId: req.id }],
        });
      }

      try {
        const updated = await subscriptionsService.resume(id);
        const plan = await plansService.getPlan(updated.planId);
        return reply.status(200).send({ subscription: formatSubscriptionDto(updated, plan?.name || 'Plan') });
      } catch (err) {
        if (err instanceof SubscriptionDomainError) {
          return reply.status(400).send({
            errors: [{ code: err.code, message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });
}
