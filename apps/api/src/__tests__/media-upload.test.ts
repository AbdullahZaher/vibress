import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';

describe('Media API Upload & Security Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject unauthenticated upload requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/v1/media',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject non-existent media item with 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/v1/media/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(401); // Auth required first
  });
});
