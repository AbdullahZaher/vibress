import { describe, it, expect, beforeAll } from 'vitest';
import { S3StorageProvider } from '../s3-storage-provider';
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

describe('Real MinIO Protocol & Storage Integration', () => {
  const MINIO_CONFIG = {
    providerType: 'minio' as const,
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'vibress-test-bucket',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    forcePathStyle: true,
  };

  let provider: S3StorageProvider;

  beforeAll(async () => {
    provider = new S3StorageProvider(MINIO_CONFIG);

    // Ensure bucket exists in local MinIO container
    const rawClient = new S3Client({
      region: MINIO_CONFIG.region,
      endpoint: MINIO_CONFIG.endpoint,
      forcePathStyle: MINIO_CONFIG.forcePathStyle,
      credentials: {
        accessKeyId: MINIO_CONFIG.accessKeyId,
        secretAccessKey: MINIO_CONFIG.secretAccessKey,
      },
    });

    try {
      await rawClient.send(new HeadBucketCommand({ Bucket: MINIO_CONFIG.bucket }));
    } catch {
      await rawClient.send(new CreateBucketCommand({ Bucket: MINIO_CONFIG.bucket }));
    }
  });

  it('should pass connection test', async () => {
    const res = await provider.testConnection();
    expect(res.connected).toBe(true);
    expect(res.bucket).toBe('vibress-test-bucket');
    expect(res.providerType).toBe('minio');
  });

  it('should put, check head/exists, and delete object', async () => {
    const key = `test-${Date.now()}/hello.txt`;
    const body = Buffer.from('Hello MinIO S3 Protocol');

    const stored = await provider.put({
      key,
      body,
      contentType: 'text/plain',
    });

    expect(stored.key).toBe(key);
    expect(stored.url).toContain(key);
    expect(stored.size).toBe(body.length);

    const exists = await provider.exists(key);
    expect(exists).toBe(true);

    const head = await provider.headObject(key);
    expect(head).not.toBeNull();
    expect(head?.size).toBe(body.length);

    await provider.delete(key);

    const existsAfter = await provider.exists(key);
    expect(existsAfter).toBe(false);
  });

  it('should generate valid signed GET and PUT URLs', async () => {
    const key = `test-${Date.now()}/signed.png`;
    const getUrl = await provider.getSignedUrl(key, { operation: 'get', expiresInSeconds: 300 });
    expect(getUrl).toContain('http://127.0.0.1:9000/vibress-test-bucket/test-');
    expect(getUrl).toContain('X-Amz-Signature');

    const putUrl = await provider.getSignedUrl(key, { operation: 'put', expiresInSeconds: 300 });
    expect(putUrl).toContain('X-Amz-Signature');
  });

  it('should support direct upload signed URLs', async () => {
    const key = `test-${Date.now()}/direct.jpg`;
    const directResult = await provider.createSignedUploadUrl({
      key,
      contentType: 'image/jpeg',
      expiresInSeconds: 600,
    });

    expect(directResult.key).toBe(key);
    expect(directResult.uploadUrl).toContain('X-Amz-Signature');
    expect(directResult.headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('should execute multipart upload lifecycle (initiate, part-url, complete)', async () => {
    const key = `test-${Date.now()}/multipart.bin`;
    const multipartSession = await provider.createMultipartUpload({
      key,
      contentType: 'application/octet-stream',
    });

    expect(multipartSession.uploadId).toBeTruthy();
    expect(multipartSession.key).toBe(key);

    const part1 = await provider.getSignedPartUrl({
      key,
      uploadId: multipartSession.uploadId,
      partNumber: 1,
    });
    expect(part1.partNumber).toBe(1);
    expect(part1.url).toContain('partNumber=1');

    // Perform real HTTP put for 5MB part 1
    const part1Buf = Buffer.alloc(5 * 1024 * 1024, 'a');
    const res1 = await fetch(part1.url, { method: 'PUT', body: part1Buf });
    expect(res1.ok).toBe(true);
    const etag1 = res1.headers.get('etag');
    expect(etag1).toBeTruthy();

    // Complete multipart
    const completed = await provider.completeMultipartUpload({
      key,
      uploadId: multipartSession.uploadId,
      parts: [{ partNumber: 1, etag: etag1! }],
    });

    expect(completed.key).toBe(key);
    expect(completed.size).toBe(5 * 1024 * 1024);

    await provider.delete(key);
  });

  it('should abort multipart upload session', async () => {
    const key = `test-${Date.now()}/abort-mp.bin`;
    const session = await provider.createMultipartUpload({
      key,
      contentType: 'application/octet-stream',
    });

    await provider.abortMultipartUpload({
      key,
      uploadId: session.uploadId,
    });

    // Completing aborted multipart should fail
    await expect(
      provider.completeMultipartUpload({
        key,
        uploadId: session.uploadId,
        parts: [{ partNumber: 1, etag: 'dummy' }],
      })
    ).rejects.toThrow();
  });
});
