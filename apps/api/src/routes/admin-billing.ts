import { FastifyInstance } from 'fastify';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import {
  productsService,
  plansService,
  offersService,
  subscriptionsService,
  billingEventRepo,
} from '../services';
import {
  AdminProductInputSchema,
  AdminPlanInputSchema,
  AdminOfferInputSchema,
  AdminSubscriptionFilterSchema,
} from '@vibress/api-contracts';
import { ProductDomainError } from '@vibress/products';
import { PlanDomainError } from '@vibress/plans';
import { OfferDomainError } from '@vibress/offers';
import { SubscriptionDomainError, SubscriptionStatus } from '@vibress/subscriptions';

export async function adminBillingRoutes(fastify: FastifyInstance) {
  const sendError = (reply: any, code: string, message: string, requestId: string, status = 400) =>
    reply.status(status).send({ errors: [{ code, message, requestId }] });

  // ---------------- Products ----------------
  fastify.get('/products', {
    preHandler: [requireStaffSession, requirePermission('products.read')],
    handler: async (req, reply) => {
      const includeArchived = String((req.query as any).includeArchived) === 'true';
      const products = await productsService.listProducts({ includeArchived });
      return reply.status(200).send({ products });
    },
  });

  fastify.post('/products', {
    preHandler: [requireStaffSession, requirePermission('products.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminProductInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid product payload', req.id);
      try {
        const product = await productsService.createProduct(parsed.data, req.user!.id);
        return reply.status(201).send({ product });
      } catch (err: unknown) {
        if (err instanceof ProductDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/products/:id', {
    preHandler: [requireStaffSession, requirePermission('products.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = AdminProductInputSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid product payload', req.id);
      try {
        const product = await productsService.updateProduct(id, parsed.data, req.user!.id);
        return reply.status(200).send({ product });
      } catch (err: unknown) {
        if (err instanceof ProductDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/products/:id/archive', {
    preHandler: [requireStaffSession, requirePermission('products.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const product = await productsService.archiveProduct(id, req.user!.id);
        return reply.status(200).send({ product });
      } catch (err: unknown) {
        if (err instanceof ProductDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  // ---------------- Plans ----------------
  fastify.get('/plans', {
    preHandler: [requireStaffSession, requirePermission('plans.read')],
    handler: async (req, reply) => {
      const productId = (req.query as any).productId as string | undefined;
      const includeArchived = (req.query as any).includeArchived === 'true';
      const plans = productId ? await plansService.listPlansByProduct(productId) : [];
      return reply.status(200).send({ plans });
    },
  });

  fastify.post('/plans', {
    preHandler: [requireStaffSession, requirePermission('plans.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminPlanInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid plan payload', req.id);
      try {
        const plan = await plansService.createPlan(parsed.data as any, req.user!.id);
        return reply.status(201).send({ plan });
      } catch (err: unknown) {
        if (err instanceof PlanDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/plans/:id', {
    preHandler: [requireStaffSession, requirePermission('plans.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = AdminPlanInputSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid plan payload', req.id);
      try {
        const plan = await plansService.updatePlan(id, parsed.data as any, req.user!.id);
        return reply.status(200).send({ plan });
      } catch (err: unknown) {
        if (err instanceof PlanDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/plans/:id/archive', {
    preHandler: [requireStaffSession, requirePermission('plans.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const plan = await plansService.archivePlan(id, req.user!.id);
        return reply.status(200).send({ plan });
      } catch (err: unknown) {
        if (err instanceof PlanDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  // ---------------- Offers ----------------
  fastify.get('/offers', {
    preHandler: [requireStaffSession, requirePermission('offers.read')],
    handler: async (req, reply) => {
      const offers = await offersService.listOffers();
      return reply.status(200).send({ offers });
    },
  });

  fastify.post('/offers', {
    preHandler: [requireStaffSession, requirePermission('offers.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parsed = AdminOfferInputSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid offer payload', req.id);
      try {
        const offer = await offersService.createOffer({
          ...parsed.data,
          startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
          endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        } as any, req.user!.id);
        return reply.status(201).send({ offer });
      } catch (err: unknown) {
        if (err instanceof OfferDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/offers/:id', {
    preHandler: [requireStaffSession, requirePermission('offers.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = AdminOfferInputSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid offer payload', req.id);
      try {
        const offer = await offersService.updateOffer(id, parsed.data as any, req.user!.id);
        return reply.status(200).send({ offer });
      } catch (err: unknown) {
        if (err instanceof OfferDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/offers/:id/disable', {
    preHandler: [requireStaffSession, requirePermission('offers.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const offer = await offersService.disableOffer(id, req.user!.id);
        return reply.status(200).send({ offer });
      } catch (err: unknown) {
        if (err instanceof OfferDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  // ---------------- Subscriptions ----------------
  fastify.get('/subscriptions', {
    preHandler: [requireStaffSession, requirePermission('subscriptions.read')],
    handler: async (req, reply) => {
      const parsed = AdminSubscriptionFilterSchema.safeParse(req.query);
      if (!parsed.success) return sendError(reply, 'VALIDATION_ERROR', 'Invalid filter', req.id);
      const result = await subscriptionsService.listSubscriptions({
        status: parsed.data.status as SubscriptionStatus | undefined,
        productId: parsed.data.productId,
        planId: parsed.data.planId,
        memberId: parsed.data.memberId,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.status(200).send({
        subscriptions: result.subscriptions.map(toAdminSubscriptionDto),
        total: result.total,
      });
    },
  });

  fastify.get('/subscriptions/:id', {
    preHandler: [requireStaffSession, requirePermission('subscriptions.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = await subscriptionsService.getSubscription(id);
      if (!sub) return sendError(reply, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found', req.id, 404);
      const events = await billingEventRepo.listForSubscription(id, 20);
      return reply.status(200).send({ subscription: toAdminSubscriptionDto(sub), events });
    },
  });

  // Admin immediate cancellation (requires manage permission; audited)
  fastify.post('/subscriptions/:id/cancel', {
    preHandler: [requireStaffSession, requirePermission('subscriptions.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = await subscriptionsService.getSubscription(id);
      if (!sub) return sendError(reply, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found', req.id, 404);
      try {
        const updated = await subscriptionsService.cancelImmediate(id);
        await billingEventRepo.record({
          subscriptionId: id,
          memberId: sub.memberId,
          type: 'subscription.administratively_cancelled',
          data: { actorId: req.user!.id },
        });
        return reply.status(200).send({ subscription: toAdminSubscriptionDto(updated) });
      } catch (err: unknown) {
        if (err instanceof SubscriptionDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  // Member's subscriptions view (from member detail)
  fastify.get('/members/:memberId/subscriptions', {
    preHandler: [requireStaffSession, requirePermission('subscriptions.read')],
    handler: async (req, reply) => {
      const { memberId } = req.params as { memberId: string };
      const result = await subscriptionsService.listSubscriptions({ memberId, limit: 50 });
      return reply.status(200).send({
        subscriptions: result.subscriptions.map(toAdminSubscriptionDto),
        total: result.total,
      });
    },
  });
}

function toAdminSubscriptionDto(sub: any) {
  return {
    id: sub.id,
    memberId: sub.memberId,
    productId: sub.productId,
    planId: sub.planId,
    status: sub.status,
    currency: sub.currency,
    amountMinor: sub.amountMinor,
    billingInterval: sub.billingInterval,
    intervalCount: sub.intervalCount,
    currentPeriodStart: sub.currentPeriodStart ? sub.currentPeriodStart.toISOString() : null,
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cancelledAt: sub.cancelledAt ? sub.cancelledAt.toISOString() : null,
    endedAt: sub.endedAt ? sub.endedAt.toISOString() : null,
    offerId: sub.offerId,
    provider: sub.provider,
    providerSubscriptionId: sub.providerSubscriptionId,
    providerCustomerId: sub.providerCustomerId,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}
