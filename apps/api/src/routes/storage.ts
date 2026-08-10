import { FastifyInstance } from 'fastify';
import {
  CreateStorageConfigurationInputSchema,
  UpdateStorageConfigurationInputSchema,
  InitiateDirectUploadInputSchema,
  CompleteDirectUploadInputSchema,
  InitiateMultipartUploadInputSchema,
  SignMultipartPartInputSchema,
  CompleteMultipartUploadInputSchema,
} from '@vibress/api-contracts';
import { storageService, mediaService } from '../services';
import { requireStaffSession, requirePermission, validateOrigin } from '../middleware/auth';
import { validateAndDetectFile } from '@vibress/media';
import { defaultStorageRegistry, StorageError } from '@vibress/storage-core';
import crypto from 'node:crypto';

export async function storageRoutes(fastify: FastifyInstance) {
  // List storage configurations
  fastify.get('/storage/configurations', {
    preHandler: [requireStaffSession, requirePermission('storage.read')],
    handler: async (req, reply) => {
      const configs = await storageService.listConfigurations();
      const sanitized = configs.map((c: any) => ({
        id: c.id,
        name: c.name,
        providerType: c.providerType,
        endpoint: c.endpoint,
        region: c.region,
        bucket: c.bucket,
        publicBaseUrl: c.publicBaseUrl,
        forcePathStyle: c.forcePathStyle,
        isActive: c.isActive,
        hasCredentials: !!c.encryptedCredentials,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));

      return reply.status(200).send({ configurations: sanitized });
    },
  });

  // Create storage configuration
  fastify.post('/storage/configurations', {
    preHandler: [requireStaffSession, requirePermission('storage.manage'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CreateStorageConfigurationInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const { accessKeyId, secretAccessKey, ...rest } = parseResult.data;
      const config = await storageService.createConfiguration(
        {
          ...rest,
          credentials: { accessKeyId, secretAccessKey },
        },
        req.user!.id
      );

      return reply.status(201).send({
        configuration: {
          id: config.id,
          name: config.name,
          providerType: config.providerType,
          endpoint: config.endpoint,
          region: config.region,
          bucket: config.bucket,
          publicBaseUrl: config.publicBaseUrl,
          forcePathStyle: config.forcePathStyle,
          isActive: config.isActive,
          hasCredentials: true,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        },
      });
    },
  });

  // Update storage configuration
  fastify.patch('/storage/configurations/:id', {
    preHandler: [requireStaffSession, requirePermission('storage.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = UpdateStorageConfigurationInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const { accessKeyId, secretAccessKey, ...rest } = parseResult.data;
      const credentials: Record<string, string> = {};
      if (accessKeyId) credentials.accessKeyId = accessKeyId;
      if (secretAccessKey) credentials.secretAccessKey = secretAccessKey;

      try {
        const updated = await storageService.updateConfiguration(
          id,
          {
            ...rest,
            credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
          },
          req.user!.id
        );

        return reply.status(200).send({
          configuration: {
            id: updated.id,
            name: updated.name,
            providerType: updated.providerType,
            endpoint: updated.endpoint,
            region: updated.region,
            bucket: updated.bucket,
            publicBaseUrl: updated.publicBaseUrl,
            forcePathStyle: updated.forcePathStyle,
            isActive: updated.isActive,
            hasCredentials: !!updated.encryptedCredentials,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
        });
      } catch (err: any) {
        if (err.code === 'STORAGE_CONFIGURATION_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'STORAGE_CONFIGURATION_NOT_FOUND', message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Test connection
  fastify.post('/storage/test', {
    preHandler: [requireStaffSession, requirePermission('storage.manage'), validateOrigin],
    handler: async (req, reply) => {
      const body = req.body as any;
      try {
        const input = 'id' in body && body.id
          ? { id: body.id }
          : {
              ...body,
              credentials: {
                accessKeyId: body.accessKeyId || body.credentials?.accessKeyId,
                secretAccessKey: body.secretAccessKey || body.credentials?.secretAccessKey,
              },
            };
        const result = await storageService.testConnection(input, req.user!.id);
        return reply.status(200).send({ result });
      } catch (err: any) {
        return reply.status(400).send({
          errors: [
            {
              code: err.code || 'STORAGE_CONNECTION_FAILED',
              message: err.message || 'Connection test failed',
              requestId: req.id,
            },
          ],
        });
      }
    },
  });

  // Activate storage configuration
  fastify.post('/storage/configurations/:id/activate', {
    preHandler: [requireStaffSession, requirePermission('storage.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const activated = await storageService.activateConfiguration(id, req.user!.id);
        return reply.status(200).send({
          activeConfiguration: {
            id: activated.id,
            name: activated.name,
            providerType: activated.providerType,
            bucket: activated.bucket,
            isActive: true,
          },
        });
      } catch (err: any) {
        return reply.status(400).send({
          errors: [
            {
              code: err.code || 'STORAGE_CONFIGURATION_INVALID',
              message: err.message || 'Activation failed',
              requestId: req.id,
            },
          ],
        });
      }
    },
  });

  // Delete configuration
  fastify.delete('/storage/configurations/:id', {
    preHandler: [requireStaffSession, requirePermission('storage.manage'), validateOrigin],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await storageService.deleteConfiguration(id, req.user!.id);
        return reply.status(200).send({ success: true });
      } catch (err: any) {
        if (err.code === 'STORAGE_PROVIDER_IN_USE') {
          return reply.status(409).send({
            errors: [{ code: 'STORAGE_PROVIDER_IN_USE', message: err.message, requestId: req.id }],
          });
        }
        if (err.code === 'STORAGE_CONFIGURATION_NOT_FOUND') {
          return reply.status(404).send({
            errors: [{ code: 'STORAGE_CONFIGURATION_NOT_FOUND', message: err.message, requestId: req.id }],
          });
        }
        throw err;
      }
    },
  });

  // Direct Upload: Initiate
  fastify.post('/media/uploads/direct/initiate', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = InitiateDirectUploadInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const activeProvider = defaultStorageRegistry.getActiveProvider();
      const caps = activeProvider.getCapabilities();

      if (!caps.directUpload || typeof activeProvider.createSignedUploadUrl !== 'function') {
        return reply.status(400).send({
          errors: [
            {
              code: 'STORAGE_CAPABILITY_NOT_SUPPORTED',
              message: `Active storage provider '${activeProvider.name}' does not support direct signed uploads. Use standard API upload.`,
              requestId: req.id,
            },
          ],
        });
      }

      // Pre-validate file inputs (size, mime safety)
      const inputData = parseResult.data;
      const dummyBuf = Buffer.alloc(10); // dummy for initial checks
      try {
        validateAndDetectFile({
          filename: inputData.originalFilename,
          buffer: dummyBuf,
          mimeType: inputData.declaredMime,
        });
      } catch (validationErr: any) {
        return reply.status(400).send({
          errors: [
            {
              code: validationErr.code || 'MEDIA_INVALID_FILE',
              message: validationErr.message,
              requestId: req.id,
            },
          ],
        });
      }

      const assetId = crypto.randomUUID();
      const storageKey = `media/${assetId}/${inputData.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const signedResult = await activeProvider.createSignedUploadUrl({
        key: storageKey,
        contentType: inputData.declaredMime,
        expiresInSeconds: 900,
      });

      const session = await (storageService as any).storageRepo.createUploadSession({
        actorId: req.user!.id,
        storageKey,
        originalFilename: inputData.originalFilename,
        declaredMime: inputData.declaredMime,
        expectedSize: inputData.expectedSize,
        assetType: inputData.assetType,
        expiresAt: signedResult.expiresAt,
      });

      return reply.status(201).send({
        uploadSessionId: session.id,
        uploadUrl: signedResult.uploadUrl,
        storageKey: signedResult.key,
        headers: signedResult.headers,
        expiresAt: signedResult.expiresAt,
      });
    },
  });

  // Direct Upload: Complete / Finalize
  fastify.post('/media/uploads/direct/complete', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CompleteDirectUploadInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const { uploadSessionId } = parseResult.data;
      const repo = (storageService as any).storageRepo;
      const session = await repo.findUploadSessionById(uploadSessionId);

      if (!session) {
        return reply.status(404).send({
          errors: [{ code: 'STORAGE_UPLOAD_INVALID', message: 'Upload session not found', requestId: req.id }],
        });
      }
      if (session.actorId !== req.user!.id) {
        return reply.status(403).send({
          errors: [{ code: 'FORBIDDEN', message: 'Upload session belongs to another user', requestId: req.id }],
        });
      }
      if (session.state !== 'pending') {
        return reply.status(400).send({
          errors: [{ code: 'STORAGE_UPLOAD_INVALID', message: `Session state is '${session.state}', expected 'pending'`, requestId: req.id }],
        });
      }
      if (session.expiresAt.getTime() < Date.now()) {
        await repo.updateUploadSessionState(uploadSessionId, 'failed');
        return reply.status(400).send({
          errors: [{ code: 'STORAGE_UPLOAD_EXPIRED', message: 'Upload session has expired', requestId: req.id }],
        });
      }

      const activeProvider = defaultStorageRegistry.getActiveProvider();
      const head = activeProvider.headObject
        ? await activeProvider.headObject(session.storageKey)
        : null;

      if (!head) {
        await repo.updateUploadSessionState(uploadSessionId, 'failed');
        return reply.status(400).send({
          errors: [{ code: 'STORAGE_UPLOAD_INVALID', message: 'Direct upload object missing in storage', requestId: req.id }],
        });
      }

      // Check size matches expected bounds
      if (head.size <= 0) {
        await repo.updateUploadSessionState(uploadSessionId, 'failed');
        await activeProvider.delete(session.storageKey).catch(() => {});
        return reply.status(400).send({
          errors: [{ code: 'MEDIA_INVALID_FILE', message: 'Direct uploaded file is zero bytes', requestId: req.id }],
        });
      }

      // Perform signature verification on initial byte range if getSignedUrl is supported
      if (activeProvider.getSignedUrl) {
        try {
          const downloadUrl = await activeProvider.getSignedUrl(session.storageKey, { operation: 'get', expiresInSeconds: 60 });
          const rangeRes = await fetch(downloadUrl, { headers: { Range: 'bytes=0-512' } });
          if (rangeRes.ok) {
            const arrBuf = await rangeRes.arrayBuffer();
            const headBuf = Buffer.from(arrBuf);
            validateAndDetectFile({
              filename: session.originalFilename,
              buffer: headBuf,
              mimeType: session.declaredMime,
            });
          }
        } catch (valErr: any) {
          await repo.updateUploadSessionState(uploadSessionId, 'failed');
          await activeProvider.delete(session.storageKey).catch(() => {});
          return reply.status(400).send({
            errors: [
              {
                code: valErr.code || 'MEDIA_MIME_MISMATCH',
                message: `Direct upload signature verification failed: ${valErr.message}`,
                requestId: req.id,
              },
            ],
          });
        }
      }

      // Create MediaAsset record
      const assetId = session.storageKey.split('/')[1] || crypto.randomUUID();
      const ext = session.originalFilename.split('.').pop() || '';

      const mediaAsset = await (mediaService as any).mediaRepo.create({
        id: assetId,
        storageProvider: activeProvider.name,
        storageKey: session.storageKey,
        originalFilename: session.originalFilename,
        displayName: session.originalFilename,
        mimeType: head.contentType || session.declaredMime,
        extension: ext,
        sizeBytes: head.size,
        checksum: head.etag || crypto.randomUUID(),
        assetType: session.assetType,
        width: null,
        height: null,
        durationMs: null,
        metadata: null,
        uploadedBy: req.user!.id,
      });

      await repo.updateUploadSessionState(uploadSessionId, 'verified');

      return reply.status(201).send({ media: mediaAsset });
    },
  });

  // Multipart Upload: Initiate
  fastify.post('/media/uploads/multipart/initiate', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = InitiateMultipartUploadInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [
            {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.errors[0]?.message || 'Invalid input',
              requestId: req.id,
            },
          ],
        });
      }

      const activeProvider = defaultStorageRegistry.getActiveProvider();
      const caps = activeProvider.getCapabilities();

      if (!caps.multipartUpload || typeof activeProvider.createMultipartUpload !== 'function') {
        return reply.status(400).send({
          errors: [
            {
              code: 'STORAGE_CAPABILITY_NOT_SUPPORTED',
              message: `Active storage provider '${activeProvider.name}' does not support multipart upload.`,
              requestId: req.id,
            },
          ],
        });
      }

      const inputData = parseResult.data;
      const assetId = crypto.randomUUID();
      const storageKey = `media/${assetId}/${inputData.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const multipartRes = await activeProvider.createMultipartUpload({
        key: storageKey,
        contentType: inputData.declaredMime,
      });

      const session = await (storageService as any).storageRepo.createUploadSession({
        actorId: req.user!.id,
        storageKey,
        originalFilename: inputData.originalFilename,
        declaredMime: inputData.declaredMime,
        expectedSize: inputData.expectedSize,
        assetType: inputData.assetType,
        expiresAt: new Date(Date.now() + 86400 * 1000), // 24 hour expiry for multipart
        multipartUploadId: multipartRes.uploadId,
      });

      return reply.status(201).send({
        uploadSessionId: session.id,
        uploadId: multipartRes.uploadId,
        storageKey,
      });
    },
  });

  // Multipart Upload: Sign Part URL
  fastify.post('/media/uploads/multipart/part-url', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = SignMultipartPartInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [{ code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message || 'Invalid input', requestId: req.id }],
        });
      }

      const { uploadSessionId, partNumber } = parseResult.data;
      const repo = (storageService as any).storageRepo;
      const session = await repo.findUploadSessionById(uploadSessionId);

      if (!session || !session.multipartUploadId) {
        return reply.status(404).send({
          errors: [{ code: 'STORAGE_MULTIPART_INVALID', message: 'Multipart upload session not found', requestId: req.id }],
        });
      }
      if (session.actorId !== req.user!.id) {
        return reply.status(403).send({
          errors: [{ code: 'FORBIDDEN', message: 'Session belongs to another user', requestId: req.id }],
        });
      }

      const activeProvider = defaultStorageRegistry.getActiveProvider();
      if (typeof activeProvider.getSignedPartUrl !== 'function') {
        return reply.status(400).send({
          errors: [{ code: 'STORAGE_CAPABILITY_NOT_SUPPORTED', message: 'Provider missing getSignedPartUrl', requestId: req.id }],
        });
      }

      const partResult = await activeProvider.getSignedPartUrl({
        key: session.storageKey,
        uploadId: session.multipartUploadId,
        partNumber,
        expiresInSeconds: 3600,
      });

      return reply.status(200).send(partResult);
    },
  });

  // Multipart Upload: Complete
  fastify.post('/media/uploads/multipart/complete', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const parseResult = CompleteMultipartUploadInputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          errors: [{ code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message || 'Invalid input', requestId: req.id }],
        });
      }

      const { uploadSessionId, parts } = parseResult.data;
      const repo = (storageService as any).storageRepo;
      const session = await repo.findUploadSessionById(uploadSessionId);

      if (!session || !session.multipartUploadId) {
        return reply.status(404).send({
          errors: [{ code: 'STORAGE_MULTIPART_INVALID', message: 'Multipart upload session not found', requestId: req.id }],
        });
      }

      const activeProvider = defaultStorageRegistry.getActiveProvider();
      if (typeof activeProvider.completeMultipartUpload !== 'function') {
        return reply.status(400).send({
          errors: [{ code: 'STORAGE_CAPABILITY_NOT_SUPPORTED', message: 'Provider missing completeMultipartUpload', requestId: req.id }],
        });
      }

      const storedObj = await activeProvider.completeMultipartUpload({
        key: session.storageKey,
        uploadId: session.multipartUploadId,
        parts,
      });

      const assetId = session.storageKey.split('/')[1] || crypto.randomUUID();
      const ext = session.originalFilename.split('.').pop() || '';

      const mediaAsset = await (mediaService as any).mediaRepo.create({
        id: assetId,
        storageProvider: activeProvider.name,
        storageKey: session.storageKey,
        originalFilename: session.originalFilename,
        displayName: session.originalFilename,
        mimeType: storedObj.contentType || session.declaredMime,
        extension: ext,
        sizeBytes: storedObj.size || session.expectedSize,
        checksum: storedObj.etag || crypto.randomUUID(),
        assetType: session.assetType,
        width: null,
        height: null,
        durationMs: null,
        metadata: null,
        uploadedBy: req.user!.id,
      });

      await repo.updateUploadSessionState(uploadSessionId, 'verified');

      return reply.status(201).send({ media: mediaAsset });
    },
  });

  // Multipart Upload: Abort
  fastify.post('/media/uploads/multipart/abort', {
    preHandler: [requireStaffSession, requirePermission('media.upload'), validateOrigin],
    handler: async (req, reply) => {
      const { uploadSessionId } = req.body as { uploadSessionId: string };
      const repo = (storageService as any).storageRepo;
      const session = await repo.findUploadSessionById(uploadSessionId);

      if (session && session.multipartUploadId) {
        const activeProvider = defaultStorageRegistry.getActiveProvider();
        if (typeof activeProvider.abortMultipartUpload === 'function') {
          await activeProvider.abortMultipartUpload({
            key: session.storageKey,
            uploadId: session.multipartUploadId,
          }).catch(() => {});
        }
        await repo.updateUploadSessionState(uploadSessionId, 'failed');
      }

      return reply.status(200).send({ success: true });
    },
  });
}
