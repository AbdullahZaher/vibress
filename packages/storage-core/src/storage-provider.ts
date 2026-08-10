export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  url: string;
  size: number;
  contentType?: string | undefined;
  etag?: string | undefined;
}

export interface SignedUrlOptions {
  expiresInSeconds?: number;
  operation?: 'get' | 'put';
}

export interface StorageCapabilities {
  signedUrls: boolean;
  directUpload: boolean;
  multipartUpload: boolean;
  privateObjects: boolean;
  publicObjects: boolean;
}

export interface CreateSignedUploadInput {
  key: string;
  contentType: string;
  contentLength?: number;
  expiresInSeconds?: number;
}

export interface SignedUploadUrlResult {
  uploadUrl: string;
  key: string;
  headers?: Record<string, string>;
  expiresAt: Date;
}

export interface CreateMultipartInput {
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface MultipartSessionResult {
  uploadId: string;
  key: string;
}

export interface SignPartInput {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}

export interface SignedPartUrlResult {
  partNumber: number;
  url: string;
  headers?: Record<string, string>;
}

export interface CompleteMultipartInput {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

export interface AbortMultipartInput {
  key: string;
  uploadId: string;
}

export interface ObjectHeadResult {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface StorageProvider {
  readonly name: string;
  getCapabilities(): StorageCapabilities;
  put(input: PutObjectInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
  getSignedUrl?(key: string, options?: SignedUrlOptions): Promise<string>;
  headObject?(key: string): Promise<ObjectHeadResult | null>;
  createSignedUploadUrl?(input: CreateSignedUploadInput): Promise<SignedUploadUrlResult>;
  createMultipartUpload?(input: CreateMultipartInput): Promise<MultipartSessionResult>;
  getSignedPartUrl?(input: SignPartInput): Promise<SignedPartUrlResult>;
  completeMultipartUpload?(input: CompleteMultipartInput): Promise<StoredObject>;
  abortMultipartUpload?(input: AbortMultipartInput): Promise<void>;
}

