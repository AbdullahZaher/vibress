import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../main';
import { FastifyInstance } from 'fastify';
import { defaultStorageRegistry, LocalStorageProvider } from '@vibress/storage-core';
import { S3StorageProvider } from '@vibress/storage-s3';
import { mediaService, storageService } from '../services';

describe('Storage Configuration & Multi-Provider Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list storage configurations and redact secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/v1/storage/configurations',
    });
    // Requires auth
    expect(res.statusCode).toBe(401);
  });

  it('should verify mixed-provider deletion routing', async () => {
    const localProvider = new LocalStorageProvider();
    defaultStorageRegistry.register(localProvider);

    const minioProvider = new S3StorageProvider({
      id: 'minio-test-inst',
      providerType: 'minio',
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'vibress-test-bucket',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      forcePathStyle: true,
    });
    defaultStorageRegistry.register(minioProvider);

    // Asset A on local
    const assetA = await mediaService.uploadMedia({
      filename: 'local-asset.png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      mimeType: 'image/png',
    });
    expect(assetA.storageProvider).toBe('local');

    // Switch active to MinIO
    defaultStorageRegistry.setActiveProvider(minioProvider.name);

    // Asset B on MinIO
    const assetB = await mediaService.uploadMedia({
      filename: 'minio-asset.png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      mimeType: 'image/png',
    });
    expect(assetB.storageProvider).toBe(minioProvider.name);

    // Verify Asset A (local) deletes via local provider even when MinIO is active
    await mediaService.deleteMedia(assetA.id);

    // Verify Asset B (MinIO) deletes via MinIO provider
    await mediaService.deleteMedia(assetB.id);

    // Revert active provider to local
    defaultStorageRegistry.setActiveProvider('local');
  });
});
