import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  StorageProvider,
  StorageCapabilities,
  PutObjectInput,
  StoredObject,
  SignedUrlOptions,
  CreateSignedUploadInput,
  SignedUploadUrlResult,
  CreateMultipartInput,
  MultipartSessionResult,
  SignPartInput,
  SignedPartUrlResult,
  CompleteMultipartInput,
  AbortMultipartInput,
  ObjectHeadResult,
  StorageError,
} from "@vibress/storage-core";
import { S3StorageConfig } from "./types";
import { resolveS3ConfigWithPreset } from "./presets";

export class S3StorageProvider implements StorageProvider {
  public readonly name: string;
  private readonly client: S3Client;
  private readonly config: S3StorageConfig;
  private readonly resolvedConfig: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    if (!config.bucket || !config.bucket.trim()) {
      throw new StorageError(
        "S3 bucket name is required",
        "STORAGE_CONFIGURATION_INVALID",
      );
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new StorageError(
        "S3 access credentials (accessKeyId and secretAccessKey) are required",
        "STORAGE_CREDENTIALS_INVALID",
      );
    }

    this.config = config;
    this.resolvedConfig = resolveS3ConfigWithPreset(config);
    this.name = config.id || `s3:${config.providerType}:${config.bucket}`;

    this.client = new S3Client({
      region: this.resolvedConfig.region,
      ...(this.resolvedConfig.endpoint
        ? { endpoint: this.resolvedConfig.endpoint }
        : {}),
      ...(this.resolvedConfig.forcePathStyle !== undefined
        ? { forcePathStyle: this.resolvedConfig.forcePathStyle }
        : {}),
      credentials: {
        accessKeyId: this.resolvedConfig.accessKeyId,
        secretAccessKey: this.resolvedConfig.secretAccessKey,
      },
    });
  }

  getCapabilities(): StorageCapabilities {
    return {
      signedUrls: true,
      directUpload: true,
      multipartUpload: true,
      privateObjects: true,
      publicObjects: true,
    };
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = this.normalizeKey(input.key);
    try {
      const command = new PutObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType || "application/octet-stream",
        Metadata: input.metadata,
      });

      const response = await this.client.send(command);
      const url = await this.getUrl(key);

      return {
        key,
        url,
        size: input.contentLength || input.body.length,
        contentType: input.contentType,
        etag: response.ETag ? response.ETag.replace(/"/g, "") : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `S3 PutObject failed for key '${key}': ${msg}`,
        "STORAGE_UPLOAD_FAILED",
      );
    }
  }

  async delete(key: string): Promise<void> {
    const normalizedKey = this.normalizeKey(key);
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: normalizedKey,
      });
      await this.client.send(command);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `S3 DeleteObject failed for key '${normalizedKey}': ${msg}`,
        "STORAGE_ERROR",
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.headObject(key);
    return head !== null;
  }

  async headObject(key: string): Promise<ObjectHeadResult | null> {
    const normalizedKey = this.normalizeKey(key);
    try {
      const command = new HeadObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: normalizedKey,
      });
      const res = await this.client.send(command);
      const result: ObjectHeadResult = {
        size: Number(res.ContentLength || 0),
      };
      if (res.ContentType) result.contentType = res.ContentType;
      if (res.ETag) result.etag = res.ETag.replace(/"/g, "");
      if (res.LastModified) result.lastModified = res.LastModified;

      return result;
    } catch (err) {
      if (
        err instanceof Error &&
        (err as { name?: string }).name === "NotFound"
      ) {
        return null;
      }
      return null;
    }
  }

  async getUrl(key: string): Promise<string> {
    const normalizedKey = this.normalizeKey(key);

    if (
      this.resolvedConfig.publicBaseUrl &&
      this.resolvedConfig.publicBaseUrl.trim()
    ) {
      const baseUrl = this.resolvedConfig.publicBaseUrl
        .trim()
        .replace(/\/+$/, "");
      return `${baseUrl}/${normalizedKey}`;
    }

    if (this.resolvedConfig.endpoint) {
      const endpoint = this.resolvedConfig.endpoint.trim().replace(/\/+$/, "");
      if (this.resolvedConfig.forcePathStyle) {
        return `${endpoint}/${this.resolvedConfig.bucket}/${normalizedKey}`;
      } else {
        const urlObj = new URL(endpoint);
        urlObj.hostname = `${this.resolvedConfig.bucket}.${urlObj.hostname}`;
        return `${urlObj.origin}/${normalizedKey}`;
      }
    }

    return `https://${this.resolvedConfig.bucket}.s3.${this.resolvedConfig.region}.amazonaws.com/${normalizedKey}`;
  }

  async getSignedUrl(
    key: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    const normalizedKey = this.normalizeKey(key);
    const ttl =
      options.expiresInSeconds ||
      this.resolvedConfig.signedUrlTtlSeconds ||
      900;
    const op = options.operation || "get";

    try {
      const command =
        op === "put"
          ? new PutObjectCommand({
              Bucket: this.resolvedConfig.bucket,
              Key: normalizedKey,
            })
          : new GetObjectCommand({
              Bucket: this.resolvedConfig.bucket,
              Key: normalizedKey,
            });

      return await getSignedUrl(this.client, command, { expiresIn: ttl });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to generate signed URL for '${normalizedKey}': ${msg}`,
        "STORAGE_ERROR",
      );
    }
  }

  async createSignedUploadUrl(
    input: CreateSignedUploadInput,
  ): Promise<SignedUploadUrlResult> {
    const key = this.normalizeKey(input.key);
    const ttl =
      input.expiresInSeconds || this.resolvedConfig.signedUrlTtlSeconds || 900;

    try {
      const command = new PutObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        ContentType: input.contentType,
      });

      const uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: ttl,
      });
      const expiresAt = new Date(Date.now() + ttl * 1000);

      return {
        uploadUrl,
        key,
        headers: {
          "Content-Type": input.contentType,
        },
        expiresAt,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to create signed upload URL: ${msg}`,
        "STORAGE_UPLOAD_INIT_FAILED",
      );
    }
  }

  async createMultipartUpload(
    input: CreateMultipartInput,
  ): Promise<MultipartSessionResult> {
    const key = this.normalizeKey(input.key);
    try {
      const command = new CreateMultipartUploadCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        ContentType: input.contentType,
        Metadata: input.metadata,
      });

      const res = await this.client.send(command);
      if (!res.UploadId) {
        throw new StorageError(
          "S3 CreateMultipartUpload returned empty UploadId",
          "STORAGE_MULTIPART_INVALID",
        );
      }

      return {
        uploadId: res.UploadId,
        key,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to initiate S3 multipart upload: ${msg}`,
        "STORAGE_UPLOAD_INIT_FAILED",
      );
    }
  }

  async getSignedPartUrl(input: SignPartInput): Promise<SignedPartUrlResult> {
    const key = this.normalizeKey(input.key);
    const ttl =
      input.expiresInSeconds || this.resolvedConfig.signedUrlTtlSeconds || 900;

    try {
      const command = new UploadPartCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn: ttl });
      return {
        partNumber: input.partNumber,
        url,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to generate signed part URL: ${msg}`,
        "STORAGE_MULTIPART_INVALID",
      );
    }
  }

  async completeMultipartUpload(
    input: CompleteMultipartInput,
  ): Promise<StoredObject> {
    const key = this.normalizeKey(input.key);
    try {
      const command = new CompleteMultipartUploadCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
          })),
        },
      });

      const res = await this.client.send(command);
      const head = await this.headObject(key);
      const url = await this.getUrl(key);

      return {
        key,
        url,
        size: head?.size || 0,
        contentType: head?.contentType,
        etag: res.ETag ? res.ETag.replace(/"/g, "") : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to complete S3 multipart upload: ${msg}`,
        "STORAGE_MULTIPART_COMPLETE_FAILED",
      );
    }
  }

  async abortMultipartUpload(input: AbortMultipartInput): Promise<void> {
    const key = this.normalizeKey(input.key);
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: key,
        UploadId: input.uploadId,
      });
      await this.client.send(command);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Failed to abort S3 multipart upload: ${msg}`,
        "STORAGE_MULTIPART_INVALID",
      );
    }
  }

  async testConnection(): Promise<{
    connected: boolean;
    bucket: string;
    providerType: string;
  }> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.resolvedConfig.bucket,
      });
      await this.client.send(command);
      return {
        connected: true,
        bucket: this.resolvedConfig.bucket,
        providerType: this.resolvedConfig.providerType,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `S3 Connection Test failed for bucket '${this.resolvedConfig.bucket}': ${msg}`,
        "STORAGE_CONNECTION_FAILED",
      );
    }
  }

  private normalizeKey(key: string): string {
    return key.replace(/^\/+/, "");
  }
}
