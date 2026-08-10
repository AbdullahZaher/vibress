import { z } from 'zod';

export const S3ProviderTypeEnum = z.enum([
  'aws-s3',
  'cloudflare-r2',
  'digitalocean-spaces',
  'wasabi',
  'backblaze-b2',
  'hetzner',
  'minio',
  'custom',
]);
export type S3ProviderTypeDto = z.infer<typeof S3ProviderTypeEnum>;

export const CreateStorageConfigurationInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  providerType: S3ProviderTypeEnum,
  endpoint: z.string().trim().optional(),
  region: z.string().trim().optional(),
  bucket: z.string().trim().min(1, 'Bucket name is required'),
  accessKeyId: z.string().trim().min(1, 'Access key ID is required'),
  secretAccessKey: z.string().trim().min(1, 'Secret access key is required'),
  forcePathStyle: z.boolean().optional(),
  publicBaseUrl: z.string().trim().optional(),
  signedUrlTtlSeconds: z.number().int().positive().optional(),
});
export interface CreateStorageConfigurationInput {
  name: string;
  providerType: S3ProviderTypeDto;
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean | undefined;
  publicBaseUrl?: string | undefined;
  signedUrlTtlSeconds?: number | undefined;
}

export const UpdateStorageConfigurationInputSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  providerType: S3ProviderTypeEnum.optional(),
  endpoint: z.string().trim().optional(),
  region: z.string().trim().optional(),
  bucket: z.string().trim().min(1).optional(),
  accessKeyId: z.string().trim().optional(),
  secretAccessKey: z.string().trim().optional(),
  forcePathStyle: z.boolean().optional(),
  publicBaseUrl: z.string().trim().optional(),
  signedUrlTtlSeconds: z.number().int().positive().optional(),
});

export interface UpdateStorageConfigurationInput {
  name?: string | undefined;
  providerType?: S3ProviderTypeDto | undefined;
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean | undefined;
  publicBaseUrl?: string | undefined;
  signedUrlTtlSeconds?: number | undefined;
}

export const InitiateDirectUploadInputSchema = z.object({
  originalFilename: z.string().trim().min(1),
  declaredMime: z.string().trim().min(1),
  expectedSize: z.number().int().positive(),
  assetType: z.enum(['image', 'video', 'audio', 'file']),
});
export type InitiateDirectUploadInput = z.infer<typeof InitiateDirectUploadInputSchema>;

export const CompleteDirectUploadInputSchema = z.object({
  uploadSessionId: z.string().min(1),
});
export type CompleteDirectUploadInput = z.infer<typeof CompleteDirectUploadInputSchema>;

export const InitiateMultipartUploadInputSchema = z.object({
  originalFilename: z.string().trim().min(1),
  declaredMime: z.string().trim().min(1),
  expectedSize: z.number().int().positive(),
  assetType: z.enum(['image', 'video', 'audio', 'file']),
});
export type InitiateMultipartUploadInput = z.infer<typeof InitiateMultipartUploadInputSchema>;

export const SignMultipartPartInputSchema = z.object({
  uploadSessionId: z.string().min(1),
  partNumber: z.number().int().positive(),
});
export type SignMultipartPartInput = z.infer<typeof SignMultipartPartInputSchema>;

export const CompleteMultipartUploadInputSchema = z.object({
  uploadSessionId: z.string().min(1),
  parts: z.array(
    z.object({
      partNumber: z.number().int().positive(),
      etag: z.string().min(1),
    })
  ).min(1),
});
export type CompleteMultipartUploadInput = z.infer<typeof CompleteMultipartUploadInputSchema>;
