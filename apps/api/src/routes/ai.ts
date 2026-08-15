import { FastifyInstance, FastifyReply } from "fastify";
import {
  requireStaffSession,
  requirePermission,
} from "../middleware/auth";
import { getAiGatewayService } from "../services";
import { AiTaskType } from "@vibress/ai";

const sendError = (
  reply: FastifyReply,
  code: string,
  message: string,
  requestId: string,
  status = 400,
) => reply.status(status).send({ errors: [{ code, message, requestId }] });

export async function aiRoutes(fastify: FastifyInstance) {
  // 1. Status: check if AI Gateway is enabled and which providers are active
  fastify.get("/ai/status", {
    preHandler: [requireStaffSession],
    handler: async (req, reply) => {
      const ai = await getAiGatewayService();
      const providers = ai.getAvailableProviders();
      const enabled = ai.isEnabled();

      return reply.send({
        data: {
          enabled,
          providers,
        },
      });
    },
  });

  // 2. Generate: synchronous AI text completion (for tone shift, summarize, translate, SEO metadata)
  fastify.post<{
    Body: {
      task?: AiTaskType | undefined;
      prompt?: string | undefined;
      context?: string | undefined;
      targetLanguage?: string | undefined;
      targetTone?: string | undefined;
      model?: string | undefined;
    };
  }>("/ai/generate", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const { prompt, context, task, targetLanguage, targetTone, model } =
        req.body || {};

      if (!prompt && !context) {
        return sendError(
          reply,
          "VALIDATION_ERROR",
          "Prompt or context is required",
          req.id,
        );
      }

      try {
        const ai = await getAiGatewayService();
        const result = await ai.generate({
          task: task || "completion",
          prompt: prompt || "",
          context: context || "",
          targetLanguage: targetLanguage || undefined,
          targetTone: targetTone || undefined,
          model: model || undefined,
          userId: req.user?.id,
        });

        return reply.send({
          data: result,
        });
      } catch (err: unknown) {
        return sendError(
          reply,
          "AI_GATEWAY_ERROR",
          err instanceof Error ? err.message : "AI generation failed",
          req.id,
          500,
        );
      }
    },
  });

  // 3. Stream: Server-Sent Events real-time streaming for inline studio completions
  fastify.post<{
    Body: {
      task?: AiTaskType | undefined;
      prompt?: string | undefined;
      context?: string | undefined;
      model?: string | undefined;
    };
  }>("/ai/stream", {
    preHandler: [requireStaffSession, requirePermission("posts.edit")],
    handler: async (req, reply) => {
      const { prompt, context, task, model } = req.body || {};

      try {
        const ai = await getAiGatewayService();

        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("X-Accel-Buffering", "no");

        for await (const chunk of ai.stream({
          task: task || "inline",
          prompt: prompt || "",
          context: context || "",
          model: model || undefined,
          userId: req.user?.id,
        })) {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        reply.raw.write(`data: [DONE]\n\n`);
        reply.raw.end();
      } catch (err: unknown) {
        if (!reply.raw.headersSent) {
          return sendError(
            reply,
            "AI_STREAM_ERROR",
            err instanceof Error ? err.message : "AI streaming failed",
            req.id,
            500,
          );
        }
        reply.raw.end();
      }
    },
  });

  // 4. Metrics: Aggregated AI request counts for admin reporting
  fastify.get("/ai/metrics", {
    preHandler: [requireStaffSession, requirePermission("settings.edit")],
    handler: async (req, reply) => {
      const ai = await getAiGatewayService();
      const metrics = await ai.getMetrics();
      return reply.send({
        data: metrics,
      });
    },
  });
}
