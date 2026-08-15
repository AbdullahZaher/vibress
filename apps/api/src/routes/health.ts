import { FastifyInstance } from "fastify";
import { getDbPool } from "@vibress/database";
import { getRedisClient } from "@vibress/cache";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health/live", async () => {
    return { status: "ok" };
  });

  fastify.get("/api/health/live", async () => {
    return { status: "ok" };
  });

  fastify.get("/health/ready", async (request, reply) => {
    let isDbReady = false;
    let isRedisReady = false;

    try {
      const pool = getDbPool();
      const res = await pool.query("SELECT 1");
      if (res.rowCount === 1) isDbReady = true;
    } catch (e) {
      fastify.log.error(e, "DB readiness check failed");
    }

    try {
      const redis = getRedisClient();
      if (redis.status === "ready") isRedisReady = true;
    } catch (e) {
      fastify.log.error(e, "Redis readiness check failed");
    }

    if (!isDbReady || !isRedisReady) {
      return reply.status(503).send({
        status: "not_ready",
        checks: {
          database: isDbReady ? "up" : "down",
          redis: isRedisReady ? "up" : "down",
        },
      });
    }

    return {
      status: "ready",
      checks: {
        database: "up",
        redis: "up",
      },
    };
  });

  fastify.get("/api/health/ready", async (request, reply) => {
    let isDbReady = false;
    let isRedisReady = false;

    try {
      const pool = getDbPool();
      const res = await pool.query("SELECT 1");
      if (res.rowCount === 1) isDbReady = true;
    } catch {
      // DB not ready
    }

    try {
      const redis = getRedisClient();
      if (redis.status === "ready") isRedisReady = true;
    } catch {
      // Redis not ready
    }

    if (!isDbReady || !isRedisReady) {
      return reply.status(503).send({
        status: "not_ready",
        checks: {
          database: isDbReady ? "up" : "down",
          redis: isRedisReady ? "up" : "down",
        },
      });
    }

    return {
      status: "ready",
      checks: {
        database: "up",
        redis: "up",
      },
    };
  });

  fastify.get("/api", async () => {
    return { name: "Vibress API", status: "ok" };
  });
}
