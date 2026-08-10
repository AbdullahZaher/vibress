import { StorageProvider, StorageCapabilities, PutObjectInput, StoredObject, SignedUrlOptions, CreateSignedUploadInput, SignedUploadUrlResult, CreateMultipartInput, MultipartSessionResult, SignPartInput, SignedPartUrlResult, CompleteMultipartInput, AbortMultipartInput, ObjectHeadResult } from '@vibress/storage-core';
import { S3StorageConfig } from './types';
export declare class S3StorageProvider implements StorageProvider {
    readonly name: string;
    private readonly client;
    private readonly config;
    private readonly resolvedConfig;
    constructor(config: S3StorageConfig);
    getCapabilities(): StorageCapabilities;
    put(input: PutObjectInput): Promise<StoredObject>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    headObject(key: string): Promise<ObjectHeadResult | null>;
    getUrl(key: string): Promise<string>;
    getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
    createSignedUploadUrl(input: CreateSignedUploadInput): Promise<SignedUploadUrlResult>;
    createMultipartUpload(input: CreateMultipartInput): Promise<MultipartSessionResult>;
    getSignedPartUrl(input: SignPartInput): Promise<SignedPartUrlResult>;
    completeMultipartUpload(input: CompleteMultipartInput): Promise<StoredObject>;
    abortMultipartUpload(input: AbortMultipartInput): Promise<void>;
    testConnection(): Promise<{
        connected: boolean;
        bucket: string;
        providerType: string;
    }>;
    private normalizeKey;
}
