import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { integrationsService, webhooksService, pluginsService } from '../services';
import { IntegrationDomainError } from '@vibress/integrations';
import { WebhookDomainError } from '@vibress/webhooks';
import { PluginDomainError } from '@vibress/plugins';

const sendError = (reply: FastifyReply, code: string, message: string, requestId: string, status = 400) =>
  reply.status(status).send({ errors: [{ code, message, requestId }] });

export async function adminIntegrationRoutes(fastify: FastifyInstance) {
  // ---------------- Integrations ----------------
  fastify.get('/integrations', {
    preHandler: [requireStaffSession, requirePermission('integrations.read')],
    handler: async (req, reply) => {
      const integrations = await integrationsService.listIntegrations();
      return reply.status(200).send({ integrations: integrations.map((i) => integrationsService.maskIntegration(i)) });
    },
  });

  fastify.post('/integrations', {
    preHandler: [requireStaffSession, requirePermission('integrations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      if (!body?.key || !body?.type || !body?.name) {
        return sendError(reply, 'VALIDATION_ERROR', 'key, type, and name are required', req.id);
      }
      try {
        const integration = await integrationsService.createIntegration({
          key: body.key,
          type: body.type,
          name: body.name,
          config: body.config || {},
          secrets: body.secrets || {},
        }, req.user!.id);
        return reply.status(201).send({ integration: integrationsService.maskIntegration(integration) });
      } catch (err: any) {
        if (err instanceof IntegrationDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/integrations/:id', {
    preHandler: [requireStaffSession, requirePermission('integrations.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      try {
        const integration = await integrationsService.updateIntegration(id, {
          name: body?.name,
          status: body?.status,
          config: body?.config,
          secrets: body?.secrets,
        }, req.user!.id);
        return reply.status(200).send({ integration: integrationsService.maskIntegration(integration) });
      } catch (err: any) {
        if (err instanceof IntegrationDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'INTEGRATION_NOT_FOUND' ? 404 : 400);
        }
        throw err;
      }
    },
  });

  // ---------------- API Keys ----------------
  fastify.get('/api-keys', {
    preHandler: [requireStaffSession, requirePermission('api_keys.read')],
    handler: async (req, reply) => {
      const keys = await integrationsService.listApiKeys();
      return reply.status(200).send({
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          integrationId: k.integrationId,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        })),
      });
    },
  });

  fastify.post('/api-keys', {
    preHandler: [requireStaffSession, requirePermission('api_keys.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      if (!body?.name || !Array.isArray(body?.scopes) || body.scopes.length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'name and at least one scope are required', req.id);
      }
      try {
        const created = await integrationsService.createApiKey({
          name: body.name,
          scopes: body.scopes,
          integrationId: body.integrationId || null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        }, req.user!.id);
        // Raw secret returned exactly once
        return reply.status(201).send({ key: created });
      } catch (err: any) {
        if (err instanceof IntegrationDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/api-keys/:id/revoke', {
    preHandler: [requireStaffSession, requirePermission('api_keys.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      await integrationsService.revokeApiKey(id, req.user!.id);
      return reply.status(200).send({ success: true });
    },
  });

  // ---------------- Webhook Endpoints ----------------
  fastify.get('/webhook-endpoints', {
    preHandler: [requireStaffSession, requirePermission('webhooks.read')],
    handler: async (req, reply) => {
      const endpoints = await webhooksService.listEndpoints();
      return reply.status(200).send({ endpoints: endpoints.map((e) => webhooksService.maskEndpoint(e)) });
    },
  });

  fastify.post('/webhook-endpoints', {
    preHandler: [requireStaffSession, requirePermission('webhooks.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      if (!body?.name || !body?.url || !Array.isArray(body?.eventTypes) || body.eventTypes.length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'name, url, and eventTypes are required', req.id);
      }
      try {
        const endpoint = await webhooksService.createEndpoint({
          name: body.name,
          url: body.url,
          secret: body.secret || null,
          eventTypes: body.eventTypes,
        }, req.user!.id);
        return reply.status(201).send({ endpoint: webhooksService.maskEndpoint(endpoint) });
      } catch (err: any) {
        if (err instanceof WebhookDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.patch('/webhook-endpoints/:id', {
    preHandler: [requireStaffSession, requirePermission('webhooks.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      try {
        const endpoint = await webhooksService.updateEndpoint(id, {
          name: body?.name,
          url: body?.url,
          secret: body?.secret,
          enabled: body?.enabled,
          eventTypes: body?.eventTypes,
        }, req.user!.id);
        return reply.status(200).send({ endpoint: webhooksService.maskEndpoint(endpoint) });
      } catch (err: any) {
        if (err instanceof WebhookDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'WEBHOOK_NOT_FOUND' ? 404 : 400);
        }
        throw err;
      }
    },
  });

  fastify.delete('/webhook-endpoints/:id', {
    preHandler: [requireStaffSession, requirePermission('webhooks.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      await webhooksService.deleteEndpoint(id, req.user!.id);
      return reply.status(200).send({ success: true });
    },
  });

  fastify.get('/webhook-deliveries', {
    preHandler: [requireStaffSession, requirePermission('webhooks.read')],
    handler: async (req, reply) => {
      const query = req.query as any;
      const result = await webhooksService.listDeliveries({
        endpointId: query.endpointId,
        status: query.status,
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.status(200).send({
        deliveries: result.deliveries.map((d) => ({
          id: d.id,
          endpointId: d.endpointId,
          eventId: d.eventId,
          eventType: d.eventType,
          status: d.status,
          attemptCount: d.attemptCount,
          lastError: d.lastError,
          responseStatus: d.responseStatus,
          createdAt: d.createdAt.toISOString(),
        })),
        total: result.total,
      });
    },
  });

  // ---------------- Plugins ----------------
  fastify.get('/plugins', {
    preHandler: [requireStaffSession, requirePermission('plugins.read')],
    handler: async (req, reply) => {
      const plugins = await pluginsService.listPlugins();
      return reply.status(200).send({ plugins });
    },
  });

  fastify.post('/plugins/register', {
    preHandler: [requireStaffSession, requirePermission('plugins.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      if (!body?.manifest) return sendError(reply, 'VALIDATION_ERROR', 'manifest is required', req.id);
      try {
        const plugin = await pluginsService.registerPlugin(body.manifest, req.user!.id);
        return reply.status(201).send({ plugin });
      } catch (err: any) {
        if (err instanceof PluginDomainError) return sendError(reply, err.code, err.message, req.id);
        throw err;
      }
    },
  });

  fastify.post('/plugins/:id/activate', {
    preHandler: [requireStaffSession, requirePermission('plugins.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const plugin = await pluginsService.activatePlugin(id, req.user!.id);
        return reply.status(200).send({ plugin });
      } catch (err: any) {
        if (err instanceof PluginDomainError) {
          return sendError(reply, err.code, err.message, req.id, err.code === 'PLUGIN_NOT_FOUND' ? 404 : 400);
        }
        throw err;
      }
    },
  });

  fastify.post('/plugins/:id/deactivate', {
    preHandler: [requireStaffSession, requirePermission('plugins.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const plugin = await pluginsService.deactivatePlugin(id, req.user!.id);
        return reply.status(200).send({ plugin });
      } catch (err: any) {
        if (err instanceof PluginDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.post('/plugins/:id/settings', {
    preHandler: [requireStaffSession, requirePermission('plugins.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      if (!body?.settings || typeof body.settings !== 'object') {
        return sendError(reply, 'VALIDATION_ERROR', 'settings object is required', req.id);
      }
      try {
        await pluginsService.setSettings(id, body.settings);
        return reply.status(200).send({ success: true });
      } catch (err: any) {
        if (err instanceof PluginDomainError) return sendError(reply, err.code, err.message, req.id, 404);
        throw err;
      }
    },
  });

  fastify.get('/plugins/:id/settings', {
    preHandler: [requireStaffSession, requirePermission('plugins.read')],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const settings = await pluginsService.listSettings(id);
      return reply.status(200).send({ settings });
    },
  });

  fastify.delete('/plugins/:id', {
    preHandler: [requireStaffSession, requirePermission('plugins.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      await pluginsService.unregisterPlugin(id, req.user!.id);
      return reply.status(200).send({ success: true });
    },
  });
}

// ---------------- Machine API key auth ----------------
export interface MachineAuthResult {
  keyId: string;
  name: string;
  scopes: string[];
}

export async function requireMachineKey(req: FastifyRequest, reply: FastifyReply): Promise<MachineAuthResult | undefined> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    reply.status(401).send({ errors: [{ code: 'AUTHENTICATION_REQUIRED', message: 'Machine authentication required', requestId: req.id }] });
    return undefined;
  }
  const rawSecret = header.slice('Bearer '.length).trim();
  const session = await integrationsService.authenticateApiKey(rawSecret);
  if (!session) {
    // Generic invalid-credential response
    reply.status(401).send({ errors: [{ code: 'AUTHENTICATION_REQUIRED', message: 'Invalid credentials', requestId: req.id }] });
    return undefined;
  }
  return { keyId: session.keyId, name: session.name, scopes: session.scopes };
}

export function requireMachineScope(scope: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = (req as any).machineAuth as MachineAuthResult | undefined;
    if (!auth) {
      reply.status(401).send({ errors: [{ code: 'AUTHENTICATION_REQUIRED', message: 'Machine authentication required', requestId: req.id }] });
      return;
    }
    if (!auth.scopes.includes(scope)) {
      reply.status(403).send({ errors: [{ code: 'SCOPE_DENIED', message: `Scope ${scope} required`, requestId: req.id }] });
      return;
    }
  };
}

export async function machineApiRoutes(fastify: FastifyInstance) {
  // Machine-only surface, authenticated via API key (separate from staff/member sessions)
  fastify.get('/status', {
    preHandler: [async (req, reply) => {
      const result = await requireMachineKey(req, reply);
      if (result) (req as any).machineAuth = result;
    }],
    handler: async (req, reply) => {
      return reply.status(200).send({ status: 'ok', principal: (req as any).machineAuth.name });
    },
  });

  fastify.post('/events', {
    config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 200 : 60, timeWindow: '1 minute' } },
    preHandler: [
      async (req, reply) => {
        const result = await requireMachineKey(req, reply);
        if (result) (req as any).machineAuth = result;
      },
      requireMachineScope('content.read'),
    ],
    handler: async (req, reply) => {
      return reply.status(200).send({ accepted: true });
    },
  });
}
